import type { Offer6Findings } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { offer6Findings } from "../test-support/workshop-findings.js";
import {
  buildWorkshopsHarness,
  FIELD_NAMES,
  type WorkshopsHarness,
} from "../test-support/workshops-harness.js";

// Feature 007 task T046 (Scenario B, quickstart V18, V19 and V23; spec FR-022 to FR-028): Offer 6 findings
// over the intake's ten fields.
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
  const id = (await h.heldWorkshop(6)).id;
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
const mixed = (): Offer6Findings => {
  const c = offer6Findings();
  c.fields[1]!.observations.freshness.status = "unknown";
  c.fields[4]!.observations.provenance.status = "unknown";
  c.overall.dependsOnUnknowns = [
    { field: FIELD_NAMES[1]!, dimension: "freshness" },
    { field: FIELD_NAMES[4]!, dimension: "provenance" },
  ];
  return c;
};

describe("Offer 6 findings", () => {
  it("starts from the intake's ten names with nothing recorded", async () => {
    const { h, id } = await setup();
    const view = h.findings.get(h.reader(), id);
    const template = view.template as Offer6Findings;
    expect(template.fields.map((f) => f.name)).toEqual(FIELD_NAMES);
    expect(
      template.fields.every((f) => Object.values(f.observations).every((o) => o.status === null)),
    ).toBe(true);
    expect(view.summary).toEqual({ knownGood: 0, gap: 0, unknown: 0, notRecorded: 50 });
  });

  it("refuses an eleventh, a missing or a foreign field", async () => {
    const { h, id } = await setup();
    const eleven = offer6Findings();
    eleven.fields.push({ ...eleven.fields[0]!, intakeName: "extra_field", name: "extra_field" });
    const foreign = offer6Findings();
    foreign.fields[3]!.intakeName = "foreign_field";
    const nine = offer6Findings();
    nine.fields.pop();
    for (const bad of [eleven, foreign, nine]) {
      expect(await problem(() => save(h, id, bad))).toMatchObject({
        status: 422,
        codes: ["field_list_fixed"],
      });
    }
    expect(h.count("workshop_finding")).toBe(0);
  });

  it("finalises mixed statuses, keeping unknown as unknown (Scenario B, V18)", async () => {
    const { h, id } = await setup();
    save(h, id, mixed());
    expect(finalise(h, id)).toMatchObject({ state: "finalised", kind: "offer_6" });
    const view = h.findings.get(h.reader(), id);
    expect(view.summary).toMatchObject({ unknown: 2, notRecorded: 0 });
    const content = view.current!.content as Offer6Findings;
    expect(content.overall.dependsOnUnknowns).toHaveLength(2);
    expect(content.fields[1]!.observations.freshness.status).toBe("unknown");
    expect(content.disclaimer).toContain("not a guarantee");
    expect(content.inputAuditScope.sources).toHaveLength(1);
    expect(h.workshops.get(h.operator(), id).state).toBe("findings_recorded");
  });

  it("refuses to finalise without the unknowns listed or a reason for a go view", async () => {
    const { h, id } = await setup();
    const c = mixed();
    c.overall = { view: "go", dependsOnUnknowns: [], reason: "" };
    save(h, id, c);
    expect(await problem(() => finalise(h, id))).toMatchObject({
      codes: ["findings_incomplete", "unknowns_not_listed", "go_reason_missing"],
    });
  });

  it("needs a reason for fewer than ten recorded fields and shows the tenth as not recorded", async () => {
    const { h, id } = await setup();
    const c = offer6Findings();
    for (const o of Object.values(c.fields[9]!.observations)) o.status = null;
    save(h, id, c);
    expect(await problem(() => finalise(h, id))).toMatchObject({
      codes: ["findings_incomplete", "too_few_fields"],
    });
    expect(
      finalise(h, id, { waiverReason: "The tenth field was not discussed" }).waiverReason,
    ).toContain("tenth");
    expect(h.findings.get(h.reader(), id).summary).toMatchObject({ unknown: 0, notRecorded: 5 });
  });

  it.each([
    ["a scope with three sources", (c: Offer6Findings) => c.inputAuditScope.sources.push("B", "C")],
    [
      "two use cases",
      (c: Offer6Findings) =>
        Object.assign(c.inputAuditScope, { useCase: ["Readmission", "Sepsis"] }),
    ],
  ])("refuses %s", async (_label, change) => {
    const { h, id } = await setup();
    const c = offer6Findings();
    change(c);
    expect(await problem(() => save(h, id, c))).toMatchObject({ status: 400 });
  });

  it.each([
    ["a date of birth with a name", "Patient Name: Avery Exampleton DOB: 03/14/1971", "phi_guard"],
    ["a sample record", "PID|1||A1^^^X||Doe^Jo", "sample_record_not_accepted"],
    ["a price", "Replacing it costs 20000 USD", "price_stated"],
    ["a guarantee", "The model is guaranteed to work", "guarantee_stated"],
  ])("refuses %s in a note, whole", async (_label, text, code) => {
    const { h, id } = await setup();
    const c = offer6Findings();
    c.fields[0]!.observations.quality.note = text;
    const refused = await problem(() => save(h, id, c));
    expect(refused.codes).toContain(code);
    expect(h.count("workshop_finding")).toBe(0);
    expect(h.anyText(/Exampleton|20000/)).toBe(false);
  });

  it("refuses a changed disclaimer and a duration in the scope", async () => {
    const { h, id } = await setup();
    expect(
      await problem(() => save(h, id, { ...offer6Findings(), disclaimer: "No disclaimer." })),
    ).toMatchObject({ codes: ["disclaimer_changed"] });
    const timed = offer6Findings();
    timed.inputAuditScope.useCase = "A 3 week audit";
    expect(await problem(() => save(h, id, timed))).toMatchObject({ codes: ["duration_stated"] });
  });

  it("keeps patient-like field names from the intake without refusing the findings", async () => {
    const { h, id } = await setup();
    const names = [
      "patient_id",
      "DOB",
      "encounter_date",
      "MRN",
      "visit type",
      "payer_id",
      "dx_code_1",
      "OBX-5",
      "admit_ts",
      "first_name",
    ];
    h.db.raw.exec("DROP TRIGGER intake_submission_fixed");
    const row = h.db.raw.prepare("SELECT payload_json p FROM intake_submission").get() as {
      p: string;
    };
    h.db.raw
      .prepare("UPDATE intake_submission SET payload_json = ?")
      .run(JSON.stringify({ ...(JSON.parse(row.p) as object), fieldNames: names }));
    const c = offer6Findings();
    c.fields.forEach((f, i) => {
      f.intakeName = names[i]!;
      f.name = names[i]!;
    });
    expect(save(h, id, c).state).toBe("draft");
  });

  it("keeps every version, with the same audit rule as Offer 1", async () => {
    const { h, id } = await setup();
    save(h, id, offer6Findings());
    finalise(h, id);
    save(h, id, mixed(), { correctionReason: "Two observations were unknown" });
    finalise(h, id);
    expect(h.findings.get(h.reader(), id).versions.map((v) => v.versionNo)).toEqual([1, 2]);
    expect(h.audit("workshop.findings.finalise")).toHaveLength(2);
    expect(h.anyText(/Readmission risk pilot|Synthetic clinical system/)).toBe(false);
  });
});
