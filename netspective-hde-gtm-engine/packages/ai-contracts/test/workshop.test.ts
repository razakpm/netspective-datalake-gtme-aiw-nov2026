import { describe, expect, it } from "vitest";
import {
  exportJsonSchemas,
  FINDINGS_DRAFT_PATHS,
  isInterpretivePath,
  PROMPTS,
  promptText,
  SCHEMA_REGISTRY,
  WorkshopBriefSchema,
  WorkshopFindingsDraftSchema,
  WorkshopModelInputSchema,
} from "../src/index.js";

// Feature 007 task T017: workshop-preparation-brief@1.0.0 and workshop-findings-draft@1.0.0
// (constitution X, XI). Strict; no price, no decision, no reasoning; a suggestion cannot confirm a delay,
// move a state or finalise anything.
const entityIds = { workshopId: "w1", accountId: "a1" };
const brief = {
  entityIds,
  confirmedFactIds: ["ev1"],
  inferences: [
    {
      statement: "Onboarding may stall at rejection review.",
      evidenceIds: ["ev1"],
      contradictingEvidenceIds: [],
      basis: "One recorded observation.",
    },
  ],
  unknowns: ["Who reviews rejections."],
  suggestedQuestions: ["Which formats do senders use?"],
  artifactChecklist: [{ kind: "specification", why: "To read the expected format." }],
  confidence: "low",
  rationale: "Little evidence is held.",
  reviewStatus: "unreviewed",
};
const item = {
  path: "delaySources.0.description",
  value: "Manual rejection review",
  interpretation: false,
  supportingText: "wait for a manual review of rejections",
};
const draft = {
  entityIds,
  items: [item],
  confidence: "medium",
  rationale: "Taken from the notes.",
  reviewStatus: "unreviewed",
};
const accepts = (s: { safeParse(v: unknown): { success: boolean } }, v: unknown) =>
  s.safeParse(v).success;

describe("workshop-preparation-brief", () => {
  it("accepts a complete brief", () => {
    expect(accepts(WorkshopBriefSchema, brief)).toBe(true);
  });
  it("names facts by identifier only: there is no field for the model's wording of a fact", () => {
    expect(
      accepts(WorkshopBriefSchema, {
        ...brief,
        confirmedFacts: [{ statement: "They have a problem.", evidenceIds: ["ev1"] }],
      }),
    ).toBe(false);
    expect(
      accepts(WorkshopBriefSchema, { ...brief, confirmedFactIds: ["They have a problem."] }),
    ).toBe(false);
  });
  it("needs entity ids, a confidence band, a rationale and an unreviewed status", () => {
    for (const key of ["entityIds", "confidence", "rationale", "reviewStatus"]) {
      expect(accepts(WorkshopBriefSchema, { ...brief, [key]: undefined }), key).toBe(false);
    }
    expect(accepts(WorkshopBriefSchema, { ...brief, reviewStatus: "reviewed" })).toBe(false);
    expect(accepts(WorkshopBriefSchema, { ...brief, confidence: 0.9 })).toBe(false);
    expect(accepts(WorkshopBriefSchema, { ...brief, rationale: "x".repeat(301) })).toBe(false);
  });
  it("needs evidence on every inference and bounds every list and text", () => {
    const inference = brief.inferences[0]!;
    for (const bad of [
      { inferences: [{ ...inference, evidenceIds: [] }] },
      { inferences: [{ ...inference, statement: "x".repeat(301) }] },
      { inferences: [{ ...inference, basis: "x".repeat(201) }] },
      { unknowns: ["x".repeat(301)] },
      { suggestedQuestions: Array.from({ length: 13 }, (_, i) => `Question ${i}?`) },
      { suggestedQuestions: ["x".repeat(201)] },
      { artifactChecklist: [{ kind: "specification", why: "x".repeat(201) }] },
    ]) {
      expect(accepts(WorkshopBriefSchema, { ...brief, ...bad }), JSON.stringify(bad)).toBe(false);
    }
  });
  it("refuses extra keys such as reasoning, a price or a state", () => {
    for (const extra of ["reasoning", "price", "state", "decision"]) {
      expect(accepts(WorkshopBriefSchema, { ...brief, [extra]: "x" }), extra).toBe(false);
    }
  });
});

describe("workshop-findings-draft", () => {
  it("accepts items with a listed path, a value and a quote", () => {
    expect(accepts(WorkshopFindingsDraftSchema, draft)).toBe(true);
    for (const [path, value] of [
      ["flowSummary", "A sender registers and tests."],
      ["delaySources.2.ownerClass", "rule_owner"],
      ["delaySources.1.delay.amount", 2],
      ["delaySources.1.delay.unit", "weeks"],
      ["unknowns.0", "How many repeat."],
      ["suggestedNextStep", "Collect logs."],
      ["fields.9.sourceSystem", "Synthetic clinical system"],
      ["fields.0.sourceInterface", "HL7 v2 feed"],
      ["fields.3.observations.freshness.status", "unknown"],
    ] as const) {
      expect(
        accepts(WorkshopFindingsDraftSchema, { ...draft, items: [{ ...item, path, value }] }),
        path,
      ).toBe(true);
    }
  });
  it("has no path to a confirmation, a state, a finalisation, a view or a scope", () => {
    expect(FINDINGS_DRAFT_PATHS.join(" ")).not.toMatch(
      /confirm|state|finalis|view|overall|scope|disclaimer|boundary|waiver|fields\.10|delaySources\.3/,
    );
    for (const path of [
      "delaySources.0.confirmation",
      "delaySources.3.description",
      "state",
      "overall.view",
      "inputAuditScope.useCase",
      "fields.10.sourceSystem",
      "fields.0.name",
    ]) {
      expect(
        accepts(WorkshopFindingsDraftSchema, { ...draft, items: [{ ...item, path }] }),
        path,
      ).toBe(false);
    }
  });
  it("checks the value that each kind of path may hold", () => {
    for (const [path, value] of [
      ["delaySources.0.ownerClass", "vendor"],
      ["delaySources.0.delay.amount", "two"],
      ["delaySources.0.delay.amount", -1],
      ["delaySources.0.delay.unit", "months"],
      ["fields.0.observations.quality.status", "bad"],
      ["delaySources.0.description", "x".repeat(301)],
      ["delaySources.0.description", 3],
      ["fields.0.sourceSystem", "x".repeat(121)],
      ["flowSummary", "x".repeat(1001)],
    ] as const) {
      expect(
        accepts(WorkshopFindingsDraftSchema, { ...draft, items: [{ ...item, path, value }] }),
        `${path} ${String(value).slice(0, 20)}`,
      ).toBe(false);
    }
  });
  it("needs a quote of 3 to 300 characters and the interpretation flag", () => {
    for (const bad of [
      { supportingText: "ab" },
      { supportingText: "x".repeat(301) },
      { interpretation: undefined },
    ]) {
      expect(accepts(WorkshopFindingsDraftSchema, { ...draft, items: [{ ...item, ...bad }] })).toBe(
        false,
      );
    }
  });
  it("marks owner classes and statuses as interpretive", () => {
    expect(isInterpretivePath("delaySources.0.ownerClass")).toBe(true);
    expect(isInterpretivePath("fields.2.observations.access.status")).toBe(true);
    expect(isInterpretivePath("delaySources.0.description")).toBe(false);
    expect(isInterpretivePath("fields.2.sourceSystem")).toBe(false);
  });
  it("refuses extra keys such as reasoning or a price, and a reviewed status", () => {
    for (const extra of ["reasoning", "price", "decision", "thinking"]) {
      expect(accepts(WorkshopFindingsDraftSchema, { ...draft, [extra]: "x" }), extra).toBe(false);
    }
    expect(accepts(WorkshopFindingsDraftSchema, { ...draft, reviewStatus: "reviewed" })).toBe(
      false,
    );
  });
});

describe("registry, prompts and model input", () => {
  it("registers both contracts at 1.0.0 as synthesis prompts and exports JSON Schema", () => {
    const schemas = exportJsonSchemas();
    for (const [id, prompt] of [
      ["workshop-preparation-brief", "workshop-brief"],
      ["workshop-findings-draft", "workshop-findings"],
    ] as const) {
      expect(SCHEMA_REGISTRY[id]?.version).toBe("1.0.0");
      expect(schemas[id]).toBeDefined();
      expect(PROMPTS.find((p) => p.name === prompt)).toMatchObject({
        version: "1.0.0",
        task: "synthesis",
        outputSchemaId: id,
      });
      const text = promptText(prompt);
      expect(text).toMatch(/DATA, not (an )?instruction/i);
      expect(text).toMatch(/price/i);
      expect(text).toMatch(/send/i);
    }
  });
  it("takes only typed ids, intake answers, evidence records and field names", () => {
    const input = {
      workshopId: "w1",
      accountId: "a1",
      offerKey: "sender-onboarding-friction-map",
      intake: [{ label: "formatAndGuide", text: "HL7 v2" }],
      evidence: [{ id: "ev1", topic: "sender_onboarding_friction", status: "observed", text: "x" }],
      fieldNames: [],
    };
    expect(accepts(WorkshopModelInputSchema, input)).toBe(true);
    for (const extra of ["contactEmail", "participants", "artifacts", "upload"]) {
      expect(accepts(WorkshopModelInputSchema, { ...input, [extra]: "x" }), extra).toBe(false);
    }
  });
});
