import { describe, expect, it } from "vitest";
import {
  blockingShortfalls,
  FINDINGS_DISCLAIMER,
  findingsShortfalls,
  newOffer6Draft,
  Offer6FindingsSchema,
  OBSERVATION_DIMENSIONS,
  renamedFields,
  scopeDurationStated,
  summariseFields,
  supportDraftItems,
  unknownObservations,
  type Offer6Findings,
} from "../../src/index.js";
import { caseById, corpus } from "./findings-cases.js";

// Feature 007 task T045 (spec FR-022 to FR-026): unknown is never merged into gap, and "not recorded" is
// not unknown.
const names = corpus.intakeFieldNames;
const complete = () =>
  caseById(corpus.offer6, "offer6-complete").content as unknown as Offer6Findings;
const codes = (content: unknown) =>
  findingsShortfalls("offer_6", content as Offer6Findings, names).map(({ code, waivable }) => ({
    code,
    waivable,
  }));

describe("Offer 6 finalisation rules", () => {
  it.each(corpus.offer6.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(codes(c.content)).toEqual(c.expectedShortfalls);
  });

  it("waives only fewer than ten recorded fields", () => {
    const nine = findingsShortfalls(
      "offer_6",
      caseById(corpus.offer6, "offer6-nine-fields-recorded").content as unknown as Offer6Findings,
      names,
    );
    expect(blockingShortfalls(nine, "The tenth field was not discussed")).toEqual([]);
    const scope = findingsShortfalls(
      "offer_6",
      caseById(corpus.offer6, "offer6-no-scope").content as unknown as Offer6Findings,
      names,
    );
    expect(blockingShortfalls(scope, "A reason that is long enough")).toHaveLength(1);
  });

  it("keeps the intake's field list: no other name, no other order", () => {
    const foreign = complete();
    foreign.fields[0]!.intakeName = "foreign_field";
    foreign.fields[0]!.name = "foreign_field";
    expect(codes(foreign)).toEqual([{ code: "field_list_fixed", waivable: false }]);
    const reordered = complete();
    reordered.fields.reverse();
    expect(codes(reordered)).toEqual([{ code: "field_list_fixed", waivable: false }]);
  });

  it("needs a reason for a changed name and shows it as changed", () => {
    const c = complete();
    c.fields[1]!.name = "discharge_status";
    expect(codes(c)).toEqual([{ code: "rename_reason_missing", waivable: false }]);
    c.fields[1]!.renameReason = "The session used the current name";
    expect(codes(c)).toEqual([]);
    expect(renamedFields(c)).toEqual([{ intakeName: names[1], name: "discharge_status" }]);
  });

  it("needs an overall view that lists real unknowns", () => {
    const c = complete();
    c.overall.view = null;
    expect(codes(c).map((s) => s.code)).toEqual(["overall_view_missing"]);
    const unknown = complete();
    unknown.fields[2]!.observations.provenance.status = "unknown";
    expect(codes(unknown).map((s) => s.code)).toEqual(["unknowns_not_listed"]);
    unknown.overall.dependsOnUnknowns = [{ field: names[2]!, dimension: "provenance" }];
    expect(codes(unknown)).toEqual([]);
    unknown.overall.dependsOnUnknowns.push({ field: names[0]!, dimension: "quality" });
    expect(codes(unknown).map((s) => s.code)).toEqual(["unknown_dependency_invalid"]);
  });

  it("needs a reason for a go view with any unknown or unrecorded observation", () => {
    const c = complete();
    c.overall = { view: "go", dependsOnUnknowns: [], reason: "" };
    expect(codes(c)).toEqual([]);
    c.fields[9]!.observations.access.status = null;
    expect(codes(c).map((s) => s.code)).toEqual(["too_few_fields", "go_reason_missing"]);
    c.overall.reason = "The unrecorded access is not needed for the pilot";
    expect(codes(c).map((s) => s.code)).toEqual(["too_few_fields"]);
  });

  it("needs the fixed disclaimer", () => {
    const c = complete();
    c.disclaimer = "This is guaranteed.";
    expect(codes(c)).toEqual([{ code: "disclaimer_changed", waivable: false }]);
  });

  it("refuses a duration stated in the scope", () => {
    expect(scopeDurationStated({ useCase: "Pilot", sources: ["System"] })).toBe(false);
    expect(scopeDurationStated({ useCase: "A 3 week audit", sources: ["System"] })).toBe(true);
    expect(scopeDurationStated({ useCase: "Audit", sources: ["System within 10 days"] })).toBe(
      true,
    );
  });
});

describe("unknown, gap and not recorded", () => {
  it("counts them separately", () => {
    const c = complete();
    const first = c.fields[0]!.observations;
    first.quality.status = "unknown";
    first.completeness.status = null;
    const before = summariseFields(complete().fields);
    const after = summariseFields(c.fields);
    expect(after.unknown).toBe(before.unknown + 1);
    expect(after.notRecorded).toBe(1);
    expect(after.gap).toBe(before.gap - 1);
    expect(after.knownGood + after.gap + after.unknown + after.notRecorded).toBe(50);
    expect(unknownObservations(c.fields)).toEqual([{ field: names[0], dimension: "quality" }]);
  });
  it("starts a draft from the intake's ten names with nothing recorded", () => {
    const draft = newOffer6Draft(names);
    expect(draft.fields.map((f) => f.name)).toEqual(names);
    expect(summariseFields(draft.fields)).toEqual({
      knownGood: 0,
      gap: 0,
      unknown: 0,
      notRecorded: 50,
    });
    expect(draft.disclaimer).toBe(FINDINGS_DISCLAIMER);
    expect(Offer6FindingsSchema.safeParse(draft).success).toBe(true);
    expect([...OBSERVATION_DIMENSIONS]).toEqual([
      "quality",
      "completeness",
      "freshness",
      "provenance",
      "access",
    ]);
  });
});

describe("Offer 6 schema", () => {
  const ok = (v: unknown) => Offer6FindingsSchema.safeParse(v).success;
  it("accepts a complete set", () => {
    expect(ok(complete())).toBe(true);
  });
  it("holds exactly ten fields, one use case and at most two sources", () => {
    const c = complete();
    const field = c.fields[0]!;
    for (const bad of [
      { ...c, fields: c.fields.slice(0, 9) },
      { ...c, fields: [...c.fields, field] },
      { ...c, fields: [{ ...field, sourceSystem: "x".repeat(121) }, ...c.fields.slice(1)] },
      { ...c, fields: [{ ...field, sampleValue: "x" }, ...c.fields.slice(1)] },
      { ...c, inputAuditScope: { useCase: ["one", "two"], sources: ["a"] } },
      { ...c, inputAuditScope: { useCase: "a", sources: ["a", "b", "c"] } },
      { ...c, inputAuditScope: { useCase: "x".repeat(201), sources: ["a"] } },
      { ...c, overall: { ...c.overall, view: "maybe" } },
      { ...c, overall: { ...c.overall, reason: "x".repeat(501) } },
      {
        ...c,
        overall: {
          ...c.overall,
          dependsOnUnknowns: Array.from({ length: 21 }, () => ({
            field: field.intakeName,
            dimension: "quality",
          })),
        },
      },
      { ...c, price: "x" },
    ]) {
      expect(ok(bad), JSON.stringify(bad).slice(0, 60)).toBe(false);
    }
  });
});

describe("the support check for suggestions", () => {
  const notes = `Test messages wait about 2 weeks for a manual review, which the exchange team does.
encounter_start_time comes from the Synthetic clinical system over the HL7 v2 feed.
Its completeness is known good.`;
  const run = (items: [string, string | number, string][], over: Record<string, unknown> = {}) =>
    supportDraftItems(
      items.map(([path, value, supportingText]) => ({
        path,
        value,
        supportingText,
        interpretation: false,
      })),
      {
        kind: "offer_1",
        notes,
        fieldNames: [],
        knownNames: ["Synthetic clinical system", "HL7 v2 feed"],
        ...over,
      },
    );
  const quote =
    "Test messages wait about 2 weeks for a manual review, which the exchange team does.";

  it("keeps what the quote bears out", () => {
    const out = run([
      ["delaySources.0.description", "Messages wait for a manual review", quote],
      ["delaySources.0.delay.amount", 2, quote],
      ["delaySources.0.delay.unit", "weeks", quote],
      ["delaySources.0.ownerClass", "operator", quote],
    ]);
    expect(out.dropped).toBe(0);
    expect(out.items.map((i) => i.interpretation)).toEqual([false, false, false, true]);
  });
  it("drops a quote that is not in the notes", () => {
    expect(
      run([
        ["delaySources.0.description", "Slow certificates", "certificates are exchanged slowly"],
      ]),
    ).toEqual({ items: [], dropped: 1 });
  });
  it("drops a number the quote does not contain", () => {
    expect(
      run([
        ["delaySources.0.delay.amount", 3, quote],
        ["delaySources.0.description", "Waits 3 weeks", quote],
      ]).dropped,
    ).toBe(2);
  });
  it("drops a system, interface or field name the quote does not contain", () => {
    expect(
      run([["delaySources.0.description", "The Synthetic clinical system is slow", quote]]).dropped,
    ).toBe(1);
  });
  it("takes Offer 6 entries only for the intake's fields, with names quoted", () => {
    const fieldQuote =
      "encounter_start_time comes from the Synthetic clinical system over the HL7 v2 feed.";
    const out = run(
      [
        ["fields.0.sourceSystem", "Synthetic clinical system", fieldQuote],
        ["fields.0.sourceInterface", "HL7 v2 feed", fieldQuote],
        [
          "fields.0.observations.completeness.status",
          "known_good",
          "Its completeness is known good.",
        ],
        ["fields.0.sourceSystem", "Synthetic claims system", fieldQuote],
        ["fields.7.sourceSystem", "Synthetic clinical system", fieldQuote],
        ["delaySources.0.description", "Waits", quote],
      ],
      { kind: "offer_6", fieldNames: ["encounter_start_time"] },
    );
    expect(out.items.map((i) => i.path)).toEqual([
      "fields.0.sourceSystem",
      "fields.0.sourceInterface",
      "fields.0.observations.completeness.status",
    ]);
    expect(out.dropped).toBe(3);
  });
  it("drops a source system that is not quoted word for word, a price and a repeated path", () => {
    const out = run(
      [
        [
          "fields.0.sourceSystem",
          "clinical records",
          "encounter_start_time comes from the Synthetic clinical system",
        ],
        ["suggestedNextStep", "We guarantee a fix", quote],
        ["flowSummary", "Messages are reviewed", quote],
        ["flowSummary", "Messages are reviewed again", quote],
      ],
      { kind: "offer_6", fieldNames: ["encounter_start_time"] },
    );
    expect(out.items).toEqual([]);
    expect(out.dropped).toBe(4);
    expect(
      run([
        ["flowSummary", "Messages are reviewed", quote],
        ["flowSummary", "Reviewed again", quote],
        ["suggestedNextStep", "We guarantee a fix", quote],
      ]).items.map((i) => i.value),
    ).toEqual(["Messages are reviewed"]);
  });
});
