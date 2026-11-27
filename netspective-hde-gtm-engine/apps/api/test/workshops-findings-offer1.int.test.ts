import { BOUNDARY_SENTENCE, type Offer1Findings } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { offer1Findings } from "../test-support/workshop-findings.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T040 (Scenario A, quickstart V15 to V17, V20 and V23; spec FR-018 to FR-021, FR-027,
// FR-028): Offer 1 findings are saved, finalised by rule and versioned.
async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, codes: error.codes ?? [], detail: error.message };
  }
  throw new Error("expected a refusal");
}
async function setup() {
  const h = buildWorkshopsHarness();
  const id = (await h.heldWorkshop(1)).id;
  return { h, id };
}
const save = (
  h: WorkshopsHarness,
  id: string,
  content: unknown,
  over: Record<string, unknown> = {},
) => {
  const current = h.findings.get(h.operator(), id).current;
  return h.findings.save(h.operator(), id, {
    content,
    ...(current ? { lockNo: current.lockNo } : {}),
    ...over,
  });
};
const finalise = (h: WorkshopsHarness, id: string, over: Record<string, unknown> = {}) =>
  h.findings.finalise(h.operator(), id, over);
const content = (view: { content: unknown }) => view.content as Offer1Findings;

describe("drafts", () => {
  it("starts from an empty template with the boundary sentence", async () => {
    const { h, id } = await setup();
    const view = h.findings.get(h.reader(), id);
    expect(view).toMatchObject({ current: null, versions: [] });
    expect(view.template).toMatchObject({ delaySources: [], boundaryNote: BOUNDARY_SENTENCE });
    expect(view.shortfalls.map((s) => s.code)).toContain("too_few_delay_sources");
  });

  it("can be saved only once the session has been held", async () => {
    const h = buildWorkshopsHarness();
    const made = h.workshops.convert(h.operator(), (await h.linkedIntake(1)).requestId);
    expect(await problem(() => save(h, made.id, offer1Findings()))).toMatchObject({
      status: 409,
      codes: ["invalid_transition"],
    });
    expect(h.count("workshop_finding")).toBe(0);
  });

  it("saves in place and refuses a stale copy", async () => {
    const { h, id } = await setup();
    const first = save(h, id, offer1Findings());
    expect(first).toMatchObject({ versionNo: 1, state: "draft", lockNo: 1, kind: "offer_1" });
    const changed = { ...offer1Findings(), flowSummary: "A shorter flow." };
    expect(save(h, id, changed)).toMatchObject({ id: first.id, versionNo: 1, lockNo: 2 });
    expect(await problem(() => save(h, id, changed, { lockNo: 1 }))).toMatchObject({
      status: 409,
      codes: ["stale_version"],
    });
    expect(h.count("workshop_finding")).toBe(1);
  });

  it("refuses a fourth delay source", async () => {
    const { h, id } = await setup();
    const four = offer1Findings();
    four.delaySources.push(four.delaySources[0]!);
    expect(await problem(() => save(h, id, four))).toMatchObject({
      status: 422,
      codes: ["too_many_delay_sources"],
    });
  });

  it.each([
    ["Patient: Jordan Testcase, MRN: 00123456", "phi_guard"],
    ["Fixing this costs $4,000", "price_stated"],
    ["We guarantee it will be fixed", "guarantee_stated"],
    ["PID|1||A1^^^X||Doe^Jo||19700101", "sample_record_not_accepted"],
  ])("refuses the whole entry for %j", async (text, code) => {
    const { h, id } = await setup();
    const bad = offer1Findings();
    bad.delaySources[1]!.description = text;
    const refused = await problem(() => save(h, id, bad));
    expect(refused.status).toBe(422);
    expect(refused.codes).toContain(code);
    expect(h.count("workshop_finding")).toBe(0);
    expect(h.anyText(/Testcase|\$4,000|Doe\^Jo/)).toBe(false);
  });

  it("refuses a field for the economic buyer or the funding path", async () => {
    const { h, id } = await setup();
    for (const key of ["economicBuyer", "fundingPath", "qualified"]) {
      expect(await problem(() => save(h, id, { ...offer1Findings(), [key]: "x" }))).toMatchObject({
        status: 400,
      });
    }
  });
});

describe("confirmations", () => {
  it("are stamped by the server, and an unconfirmed delay is never shown as confirmed (V17)", async () => {
    const { h, id } = await setup();
    const given = offer1Findings();
    given.delaySources[0]!.confirmation = "confirmed";
    given.delaySources[0]!.confirmedBy = "somebody-else";
    given.delaySources[0]!.confirmedAt = "2001-01-01T00:00:00.000Z";
    given.delaySources[1]!.confirmation = "not_confirmed";
    given.delaySources[2]!.confirmation = "unknown";
    given.delaySources[2]!.confirmedBy = "somebody-else";
    const saved = content(save(h, id, given));
    expect(saved.delaySources[0]).toMatchObject({
      confirmation: "confirmed",
      confirmedBy: "operator-1",
      confirmedAt: h.now().toISOString(),
    });
    expect(saved.delaySources[1]).toMatchObject({ confirmation: "not_confirmed" });
    expect(saved.delaySources[2]!.confirmedBy).toBeUndefined();
    // Saving again later keeps the original stamp; changing the delay renews it.
    const stamped = saved.delaySources[0]!.confirmedAt;
    h.advance(60_000);
    expect(content(save(h, id, saved)).delaySources[0]!.confirmedAt).toBe(stamped);
    const reworded = structuredClone(saved);
    reworded.delaySources[0]!.description = "A different delay.";
    expect(content(save(h, id, reworded)).delaySources[0]!.confirmedAt).toBe(h.now().toISOString());
  });
});

describe("finalising", () => {
  it("moves the workshop to findings recorded once and announces it (Scenario A, V15)", async () => {
    const { h, id } = await setup();
    save(h, id, offer1Findings());
    const done = finalise(h, id);
    expect(done).toMatchObject({
      state: "finalised",
      finalisedBy: "operator-1",
      waiverReason: null,
    });
    const workshop = h.workshops.get(h.operator(), id);
    expect(workshop.state).toBe("findings_recorded");
    expect(workshop.history.at(-1)).toMatchObject({
      fromState: "held",
      toState: "findings_recorded",
    });
    expect(h.outbox("workshop.findings_recorded")).toEqual([
      { workshop_id: id, offer_id: "offer-1", version_no: 1, waived: false },
    ]);
    expect(h.audit("workshop.findings.finalise")).toHaveLength(1);
    expect(h.anyText(/manual review of rejections|rule changes/i)).toBe(false);
    expect(await problem(() => finalise(h, id))).toMatchObject({ codes: ["findings_not_draft"] });
    // Closing is now allowed.
    expect(
      (
        await h.workshops.transition(h.operator(), id, {
          action: "close",
          lockNo: workshop.lockNo,
          note: "findings agreed",
        })
      ).state,
    ).toBe("closed");
  });

  it("needs a reason for fewer than three delay sources and records the waiver (V16)", async () => {
    const { h, id } = await setup();
    const two = offer1Findings();
    two.delaySources.pop();
    save(h, id, two);
    const refused = await problem(() => finalise(h, id));
    expect(refused).toMatchObject({
      status: 422,
      codes: ["findings_incomplete", "too_few_delay_sources"],
    });
    expect(await problem(() => finalise(h, id, { waiverReason: "too short" }))).toMatchObject({
      status: 400,
    });
    expect(
      finalise(h, id, { waiverReason: "Only two sources came up in the session" }),
    ).toMatchObject({
      state: "finalised",
      waiverReason: "Only two sources came up in the session",
    });
    expect(h.outbox("workshop.findings_recorded")[0]).toMatchObject({ waived: true });
  });

  it("cannot waive a missing owner class or boundary note", async () => {
    const { h, id } = await setup();
    const bad = offer1Findings();
    bad.delaySources[0]!.ownerClass = null;
    bad.boundaryNote = "";
    save(h, id, bad);
    expect(
      await problem(() => finalise(h, id, { waiverReason: "A reason that is long enough" })),
    ).toMatchObject({
      codes: ["findings_incomplete", "owner_class_missing", "boundary_note_missing"],
    });
    expect(h.workshops.get(h.operator(), id).state).toBe("held");
  });

  it("never changes a finalised version; a correction is a new version with a reason (V20)", async () => {
    const { h, id } = await setup();
    save(h, id, offer1Findings());
    const v1 = finalise(h, id);
    const corrected = { ...offer1Findings(), flowSummary: "A corrected flow." };
    expect(await problem(() => save(h, id, corrected))).toMatchObject({
      status: 422,
      codes: ["correction_reason_required"],
    });
    const draft = save(h, id, corrected, { correctionReason: "The sender corrected the flow" });
    expect(draft).toMatchObject({
      versionNo: 2,
      state: "draft",
      correctionReason: "The sender corrected the flow",
    });
    const view = h.findings.get(h.reader(), id);
    expect(view.versions).toHaveLength(2);
    expect(view.versions[0]).toEqual(v1);
    expect(finalise(h, id).versionNo).toBe(2);
    expect(h.outbox("workshop.findings_recorded")).toHaveLength(1);
    expect(h.workshops.get(h.operator(), id).state).toBe("findings_recorded");
  });

  it("takes a later confirmation only as a correction, finalised again", async () => {
    const { h, id } = await setup();
    save(h, id, offer1Findings());
    const v1 = finalise(h, id);
    const confirmed = structuredClone(content(v1));
    confirmed.delaySources[0]!.confirmation = "confirmed";
    expect(await problem(() => save(h, id, confirmed))).toMatchObject({
      codes: ["correction_reason_required"],
    });
    save(h, id, confirmed, { correctionReason: "The buyer confirmed the first delay" });
    const v2 = finalise(h, id);
    expect(content(v2).delaySources[0]).toMatchObject({ confirmedBy: "operator-1" });
    expect(content(h.findings.get(h.reader(), id).versions[0]!).delaySources[0]!.confirmation).toBe(
      "unknown",
    );
  });

  it("lets only a person with the edit permission save or finalise", async () => {
    const { h, id } = await setup();
    for (const actor of [h.reader(), h.analyst(), h.automated("ai"), h.automated("system")]) {
      expect(
        await problem(() => h.findings.save(actor, id, { content: offer1Findings() })),
      ).toMatchObject({ status: 403 });
      expect(await problem(() => h.findings.finalise(actor, id))).toMatchObject({ status: 403 });
    }
  });
});
