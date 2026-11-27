import { describe, expect, it } from "vitest";
import {
  BOUNDARY_SENTENCE,
  blockingShortfalls,
  findingsShortfalls,
  findingsTextProblems,
  newOffer1Draft,
  Offer1FindingsSchema,
  type Offer1Findings,
} from "../../src/index.js";
import { caseById, corpus } from "./findings-cases.js";

// Feature 007 task T039 (spec FR-018 to FR-021, FR-028).
const complete = () =>
  caseById(corpus.offer1, "offer1-complete").content as unknown as Offer1Findings;
const shortfalls = (content: unknown) =>
  findingsShortfalls("offer_1", content as Offer1Findings).map(({ code, waivable }) => ({
    code,
    waivable,
  }));

describe("Offer 1 finalisation rules", () => {
  it.each(corpus.offer1.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(shortfalls(c.content)).toEqual(c.expectedShortfalls);
  });

  it("lets only a shortfall of delay sources be waived, with a reason of ten characters", () => {
    const two = findingsShortfalls(
      "offer_1",
      caseById(corpus.offer1, "offer1-two-delay-sources").content as unknown as Offer1Findings,
    );
    expect(blockingShortfalls(two, undefined).map((s) => s.code)).toEqual([
      "too_few_delay_sources",
    ]);
    expect(blockingShortfalls(two, "short")).toHaveLength(1);
    expect(blockingShortfalls(two, "   spaces      ")).toHaveLength(1);
    expect(blockingShortfalls(two, "Only two sources came up in the session")).toEqual([]);
    const noOwner = findingsShortfalls(
      "offer_1",
      caseById(corpus.offer1, "offer1-missing-owner-class").content as unknown as Offer1Findings,
    );
    expect(blockingShortfalls(noOwner, "A reason that is long enough")).toHaveLength(1);
  });

  it("needs the summary, each description and delay, and the next step", () => {
    const c = complete();
    c.flowSummary = " ";
    c.delaySources[0]!.description = "";
    c.delaySources[1]!.delay = null;
    c.suggestedNextStep = "";
    expect(shortfalls(c).map((s) => s.code)).toEqual([
      "flow_summary_missing",
      "delay_description_missing",
      "delay_missing",
      "next_step_missing",
    ]);
  });

  it("needs the boundary note to begin with the standard sentence", () => {
    const c = complete();
    c.boundaryNote = `We also fix it for free. ${BOUNDARY_SENTENCE}`;
    expect(shortfalls(c)).toEqual([{ code: "boundary_note_missing", waivable: false }]);
    c.boundaryNote = `${BOUNDARY_SENTENCE} Scoping starts only after agreement.`;
    expect(shortfalls(c)).toEqual([]);
  });

  it("says each shortfall in plain words", () => {
    for (const s of findingsShortfalls("offer_1", newOffer1Draft())) {
      expect(s.message.length).toBeGreaterThan(10);
      expect(s.message).not.toContain("_");
    }
  });
});

describe("Offer 1 schema", () => {
  const ok = (value: unknown) => Offer1FindingsSchema.safeParse(value).success;
  it("accepts a complete set and a new draft", () => {
    expect(ok(complete())).toBe(true);
    expect(ok(newOffer1Draft())).toBe(true);
    expect(newOffer1Draft()).toMatchObject({
      delaySources: [],
      boundaryNote: BOUNDARY_SENTENCE,
    });
  });
  it("holds at most three delay sources and bounds every text", () => {
    const c = complete();
    const source = c.delaySources[0]!;
    for (const bad of [
      { ...c, delaySources: [source, source, source, source] },
      { ...c, flowSummary: "x".repeat(1001) },
      { ...c, delaySources: [{ ...source, description: "x".repeat(301) }] },
      { ...c, delaySources: [{ ...source, ownerClass: "vendor" }] },
      { ...c, delaySources: [{ ...source, confirmation: "maybe" }] },
      {
        ...c,
        delaySources: [{ ...source, delay: { kind: "quantified", amount: 0, unit: "days" } }],
      },
      {
        ...c,
        delaySources: [{ ...source, delay: { kind: "quantified", amount: 2, unit: "months" } }],
      },
      { ...c, delaySources: [{ ...source, delay: { kind: "quantified" } }] },
      { ...c, unknowns: Array.from({ length: 11 }, (_, i) => `unknown ${i}`) },
      { ...c, unknowns: ["x".repeat(301)] },
      { ...c, suggestedNextStep: "x".repeat(501) },
      { ...c, boundaryNote: "x".repeat(601) },
    ]) {
      expect(ok(bad), JSON.stringify(bad).slice(0, 80)).toBe(false);
    }
  });
  it("has no field for a price, a budget, a fee, a guarantee or a qualification", () => {
    for (const key of [
      "price",
      "budget",
      "fee",
      "guarantee",
      "economicBuyer",
      "funding",
      "fundingPath",
      "qualified",
      "qualification",
    ]) {
      expect(ok({ ...complete(), [key]: "x" }), key).toBe(false);
    }
  });
});

describe("what a finding may not say", () => {
  it.each([
    ["A fix would cost $12,000.", "price_stated"],
    ["Priced at 5000 USD", "price_stated"],
    ["Our fee for this is small.", "price_stated"],
    ["Their budget is approved.", "price_stated"],
    ["We guarantee a two week turnaround.", "guarantee_stated"],
    ["Delivery is guaranteed.", "guarantee_stated"],
    ["PID|1||A1^^^X||Y^Z||19700101", "sample_record_not_accepted"],
    ["a\tb\tc\td", "sample_record_not_accepted"],
    ["1,north,open,3\n2,south,closed,4", "sample_record_not_accepted"],
  ])("refuses %j", (text, code) => {
    expect(findingsTextProblems([text])).toEqual([code]);
  });
  it.each([
    "The HL7 v2 feed waits 2 weeks for review.",
    "Senders, rule owners, and operators agree changes quarterly, then test.",
    "Remediation, scoping and delivery are paid work outside it.",
    "Rework costs the sender about two weeks.",
    "Segment OBX | PID mapping is unclear.",
  ])("accepts %j", (text) => {
    expect(findingsTextProblems([text])).toEqual([]);
  });
});
