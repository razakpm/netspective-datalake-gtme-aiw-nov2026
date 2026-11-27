import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GUARD_VERSION, guardValue } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T035 (Scenario D, quickstart V13 and V14; spec FR-014 to FR-017, SC-004): artifacts and
// the data boundary. Synthetic samples only.
const SAMPLES = (
  JSON.parse(
    readFileSync(
      join(import.meta.dirname, "../../../tests/fixtures/phi-samples/prohibited.json"),
      "utf8",
    ),
  ) as { id: string; content: unknown }[]
).map((s) => ({
  id: s.id,
  content: typeof s.content === "string" ? s.content : JSON.stringify(s.content),
}));
const PHI = "Patient: Jordan Testcase, MRN: 00123456, admitted for observation.";
const CLEAN = "2026-11-02 rejected: segment OBX missing a unit code (value removed)";

async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return {
      status: error.status,
      codes: error.codes ?? [],
      ruleIds: error.ruleIds ?? [],
      detail: error.message,
    };
  }
  throw new Error("expected a refusal");
}
async function setup(options: Parameters<typeof buildWorkshopsHarness>[0] = {}) {
  const h = buildWorkshopsHarness(options);
  const workshop = h.workshops.convert(h.operator(), (await h.linkedIntake(1)).requestId);
  return { h, id: workshop.id };
}
const record = (h: WorkshopsHarness, id: string, over: Record<string, unknown> = {}) =>
  h.artifacts.record(h.operator(), id, {
    kind: "scrubbed_rejection_log",
    title: "Rejection log",
    content: CLEAN,
    fileName: "rejections.log",
    ...over,
  });
const reason = "Reviewed with the sender";
const decide = (h: WorkshopsHarness, artifactId: string, decision: "release" | "discard") =>
  h.artifacts.decide(h.administrator(), artifactId, { decision, reason });
/** Every workshop table, the audit trail, the events and the guard records, as one string. */
const everywhere = (h: WorkshopsHarness) =>
  JSON.stringify(
    [
      "workshop",
      "workshop_state_history",
      "workshop_participant",
      "workshop_artifact",
      "audit_event",
      "outbox_event",
      "phi_guard_decision",
    ].map((table) => h.db.raw.prepare(`SELECT * FROM ${table}`).all()),
  );
const alerts = (h: WorkshopsHarness) => h.outbox("operator.alert.phi");

describe("clean artifacts", () => {
  it("records a reference and a clean scrubbed log, hashed and kept in file storage", async () => {
    const { h, id } = await setup();
    const reference = await h.artifacts.record(h.operator(), id, {
      kind: "specification",
      title: "Interface specification",
      reference: "Shared drive, exchange folder",
      suppliedBy: "Integration lead",
    });
    expect(reference).toMatchObject({
      state: "received",
      classification: "non_phi",
      hasContent: false,
      sizeBytes: null,
      holdRuleIds: [],
      suppliedBy: "Integration lead",
    });
    const log = await record(h, id);
    expect(log).toMatchObject({ state: "received", hasContent: true, sizeBytes: CLEAN.length });
    expect(h.files.keys()).toContain(`workshop-${id}-scrubbed_rejection_log-${log.id}.log`);
    expect(
      h.db.raw.prepare("SELECT content_sha256 s FROM workshop_artifact WHERE id = ?").get(log.id),
    ).toMatchObject({ s: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(everywhere(h)).not.toContain("value removed");
    expect(await h.artifacts.content(h.reader(), log.id)).toEqual({
      text: CLEAN,
      fileName: `workshop-${id}-scrubbed_rejection_log-${log.id}.log`,
    });
    const listed = await h.artifacts.list(h.reader(), id);
    expect(listed.items).toHaveLength(2);
    expect(listed.checklist.filter((c) => c.status === "received").map((c) => c.kind)).toEqual([
      "specification",
      "scrubbed_rejection_log",
    ]);
    expect(h.audit("workshop.artifact.record")).toHaveLength(2);
  });

  it("refuses an unknown kind, a binary file, too much text and an entry with nothing in it", async () => {
    const { h, id } = await setup();
    for (const [over, status, code] of [
      [{ kind: "patient_extract" }, 422, "artifact_kind_not_allowed"],
      [{ fileName: "scan.pdf" }, 422, "binary_not_accepted"],
      [{ content: "a\u0000b" }, 422, "binary_not_accepted"],
      [{ content: "x".repeat(1_048_577) }, 413, "content_too_large"],
      [{ content: undefined, fileName: undefined }, 422, "reference_or_content_required"],
    ] as const) {
      expect(await problem(() => record(h, id, over)), code).toMatchObject({
        status,
        codes: [code],
      });
    }
    expect(h.count("workshop_artifact")).toBe(0);
    expect(h.files.keys().filter((k) => k.startsWith("workshop-"))).toEqual([]);
  });

  it("leaves no row behind when the file cannot be stored", async () => {
    const { h, id } = await setup();
    h.files.failNext("put");
    expect(await problem(() => record(h, id))).toMatchObject({ codes: ["storage_failed"] });
    expect(h.count("workshop_artifact")).toBe(0);
  });
});

describe("the data boundary", () => {
  it.each(SAMPLES)("holds the prohibited sample $id and keeps it nowhere else", async (sample) => {
    const { h, id } = await setup();
    const held = await record(h, id, { content: sample.content, fileName: "sample.txt" });
    expect(held.state).toBe("held");
    expect(held.hasContent).toBe(false);
    expect(held.holdRuleIds.length).toBeGreaterThan(0);
    expect(h.count("quarantine_item", "entry_point = 'upload' AND status = 'held'")).toBe(1);
    const stored = h.db.raw.prepare("SELECT content_encrypted c FROM quarantine_item").get() as {
      c: Uint8Array;
    };
    expect(Buffer.from(stored.c).toString("utf8")).not.toContain(sample.content);
    expect(everywhere(h)).not.toContain(sample.content);
    expect(h.files.keys().filter((k) => k.startsWith("workshop-"))).toEqual([]);
    expect(alerts(h)).toHaveLength(1);
    expect(alerts(h)[0]).toMatchObject({ entryPoint: "upload", action: "quarantine" });
    expect(h.audit("workshop.artifact.hold")).toHaveLength(1);
    expect(h.audit("phi.quarantined")).toHaveLength(1);
    expect(h.llm.calls).toEqual([]);
  });

  it("lists every hold but raises at most one alert a minute", async () => {
    const { h, id } = await setup();
    await record(h, id, { content: PHI });
    await record(h, id, { content: PHI, title: "Second log" });
    expect(alerts(h)).toHaveLength(1);
    const listed = await h.artifacts.list(h.operator(), id);
    expect(listed.items.map((a) => a.state)).toEqual(["held", "held"]);
    expect(h.quarantine.list("held")).toHaveLength(2);
    h.advance(61_000);
    await record(h, id, { content: PHI, title: "Third log" });
    expect(alerts(h)).toHaveLength(2);
  });

  it.each(["title", "reference", "suppliedBy"])(
    "refuses a patient-like %s whole",
    async (field) => {
      const { h, id } = await setup();
      const text = field === "suppliedBy" ? "Patient: Jordan Testcase, MRN: 00123456" : PHI;
      expect(await problem(() => record(h, id, { [field]: text }))).toMatchObject({
        status: 422,
        codes: ["phi_guard"],
      });
      expect(h.count("workshop_artifact")).toBe(0);
      expect(h.count("quarantine_item")).toBe(0);
      expect(everywhere(h)).not.toContain("Testcase");
    },
  );

  it("refuses the entry when the check cannot run", async () => {
    const { h, id } = await setup({
      guard: () => {
        throw new Error("guard down");
      },
    });
    expect(await problem(() => record(h, id))).toMatchObject({
      status: 422,
      codes: ["guard_unavailable"],
    });
    expect(h.count("workshop_artifact")).toBe(0);
  });

  it("rejects instead of holding when review is switched off, and still alerts", async () => {
    const { h, id } = await setup({ uploadQuarantine: false });
    expect(await problem(() => record(h, id, { content: PHI }))).toMatchObject({
      status: 422,
      codes: ["phi_guard"],
      ruleIds: ["PHI.MRN_WITH_NAME"],
    });
    expect(h.count("workshop_artifact")).toBe(0);
    expect(h.count("quarantine_item")).toBe(0);
    expect(alerts(h)).toHaveLength(1);
    expect(everywhere(h)).not.toContain("Testcase");
  });
});

describe("deciding a held artifact", () => {
  async function held(options: Parameters<typeof buildWorkshopsHarness>[0] = {}) {
    const made = await setup(options);
    const artifact = await record(made.h, made.id, { content: PHI });
    return { ...made, artifactId: artifact.id };
  }

  it("needs quarantine.review and a reason", async () => {
    const { h, artifactId } = await held();
    for (const actor of [h.operator(), h.lead(), h.reader(), h.automated("ai")]) {
      expect(
        await problem(() => h.artifacts.decide(actor, artifactId, { decision: "release", reason })),
      ).toMatchObject({ status: 403 });
    }
    expect(
      await problem(() =>
        h.artifacts.decide(h.administrator(), artifactId, { decision: "release" }),
      ),
    ).toMatchObject({ status: 400 });
  });

  it("releases what the reviewer released: the content is rechecked, taken once and stored", async () => {
    const { h, id, artifactId } = await held();
    const released = await decide(h, artifactId, "release");
    expect(released).toMatchObject({ state: "released", hasContent: true });
    expect((await h.artifacts.content(h.reader(), artifactId)).text).toBe(PHI);
    expect(h.count("quarantine_item", "released_consumed_at IS NOT NULL")).toBe(1);
    expect((await h.artifacts.list(h.reader(), id)).checklist).toContainEqual(
      expect.objectContaining({ kind: "scrubbed_rejection_log", status: "received" }),
    );
    expect(await problem(() => decide(h, artifactId, "discard"))).toMatchObject({
      status: 409,
      codes: ["artifact_already_decided"],
    });
    expect(h.llm.calls).toEqual([]);
  });

  it("keeps it held, unconsumed, when a rule other than the released ones now matches", async () => {
    let extra = false;
    const { h, artifactId } = await held({
      guard: (value, options) => {
        const real = guardValue(value, options);
        return extra && real.decision !== "allow"
          ? { ...real, rule_ids: [...real.rule_ids, "PHI.SSN"] }
          : real;
      },
    });
    extra = true;
    expect(await problem(() => decide(h, artifactId, "release"))).toMatchObject({
      status: 409,
      codes: ["held_for_review"],
      ruleIds: ["PHI.SSN"],
    });
    expect(h.count("workshop_artifact", "state = 'held'")).toBe(1);
    expect(h.count("quarantine_item", "status = 'released' AND released_consumed_at IS NULL")).toBe(
      1,
    );
    expect(h.files.keys().filter((k) => k.startsWith("workshop-"))).toEqual([]);
  });

  it("keeps it held when the guard is a different version from the one that held it", async () => {
    const { h, artifactId } = await held();
    h.db.raw.prepare("UPDATE quarantine_item SET guard_version = 'guard-older'").run();
    expect(await problem(() => decide(h, artifactId, "release"))).toMatchObject({
      codes: ["held_for_review"],
    });
    expect(GUARD_VERSION).not.toBe("guard-older");
  });

  it("discards it, and it stays discarded", async () => {
    const { h, id, artifactId } = await held();
    expect((await decide(h, artifactId, "discard")).state).toBe("discarded");
    expect(h.count("quarantine_item", "status = 'discarded' AND content_encrypted IS NULL")).toBe(
      1,
    );
    expect(await problem(() => decide(h, artifactId, "release"))).toMatchObject({ status: 409 });
    expect(await problem(() => h.artifacts.content(h.reader(), artifactId))).toMatchObject({
      status: 409,
      codes: ["artifact_discarded"],
    });
    expect((await h.artifacts.list(h.reader(), id)).checklist).toContainEqual(
      expect.objectContaining({ kind: "scrubbed_rejection_log", status: "not_received" }),
    );
  });

  it("cannot release content that quarantine retention has purged", async () => {
    const { h, artifactId } = await held();
    h.advanceDays(31);
    h.db.transaction((tx) => h.quarantine.purgeExpired(tx));
    expect(await problem(() => decide(h, artifactId, "release"))).toMatchObject({
      status: 409,
      codes: ["content_purged"],
    });
    expect(h.count("quarantine_item", "status = 'held'")).toBe(1);
    expect((await decide(h, artifactId, "discard")).state).toBe("discarded");
  });

  it.each(["release", "discard"] as const)(
    "follows a %s made through the general quarantine screen",
    async (decision) => {
      const { h, id, artifactId } = await held();
      const item = h.quarantine.list("held")[0]!.id;
      h.db.transaction((tx) =>
        h.quarantine[decision](
          tx,
          { userId: "admin-1", actorType: "human", correlationId: null },
          item,
          reason,
        ),
      );
      const listed = await h.artifacts.list(h.reader(), id);
      expect(listed.items[0]).toMatchObject({
        id: artifactId,
        state: decision === "release" ? "released" : "discarded",
      });
    },
  );

  it("does not give out the content of a held artifact", async () => {
    const { h, artifactId } = await held();
    expect(await problem(() => h.artifacts.content(h.reader(), artifactId))).toMatchObject({
      status: 409,
      codes: ["held_for_review"],
    });
  });

  it("says a deleted file is gone, and gives nothing for a reference", async () => {
    const { h, id } = await setup();
    const log = await record(h, id);
    h.db.raw
      .prepare("UPDATE workshop_artifact SET file_deleted_at = ? WHERE id = ?")
      .run(h.now().toISOString(), log.id);
    expect(await problem(() => h.artifacts.content(h.reader(), log.id))).toMatchObject({
      status: 410,
      codes: ["file_deleted"],
    });
    const reference = await record(h, id, {
      content: undefined,
      fileName: undefined,
      reference: "Shared drive",
    });
    expect(await problem(() => h.artifacts.content(h.reader(), reference.id))).toMatchObject({
      status: 404,
      codes: ["no_content"],
    });
    expect(await problem(() => h.artifacts.content(h.automated("ai"), log.id))).toMatchObject({
      status: 403,
    });
  });
});
