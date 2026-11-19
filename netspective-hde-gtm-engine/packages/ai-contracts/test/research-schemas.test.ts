import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AccountHypothesisProposalsSchema,
  AccountResearchSummarySchema,
  ProblemInterpretationSchema,
  ServiceCapabilityMatchSchema,
  SignalExtractionSchema,
  SCHEMA_REGISTRY,
  exportJsonSchemas,
  PROTECTED_TOPICS,
} from "../src/index.js";

// Task T005: the research and hypothesis output schemas (constitution X): strict, no reasoning field, no
// numeric confidence, no evidence status that the agent could not hold, with a stable JSON Schema export.
const FIXTURES = join(import.meta.dirname, "../fixtures");
const fixture = (name: string) =>
  JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Record<string, unknown>;

const finding = (over: Record<string, unknown> = {}) => ({
  key: "f1",
  kind: "fact",
  topic: "other",
  statement: "The exchange published an updated implementation guide.",
  supportingText: "updated implementation guide",
  sourceFetchId: "fetch-1",
  typeKey: "implementation_guide_change",
  extractionConfidence: "high",
  ...over,
});

describe("example fixtures validate", () => {
  it.each([
    ["signal-extraction.json", SignalExtractionSchema],
    ["account-research-summary.json", AccountResearchSummarySchema],
    ["account-hypothesis-proposals.json", AccountHypothesisProposalsSchema],
    ["problem-interpretation.json", ProblemInterpretationSchema],
  ] as const)("%s", (name, schema) => {
    expect(schema.safeParse(fixture(name)).success).toBe(true);
  });
  it("the capability match fixture validates", () => {
    expect(
      ServiceCapabilityMatchSchema.safeParse({
        capabilityKey: "multi_format_intake",
        band: "medium",
        reason: "Several formats are named.",
      }).success,
    ).toBe(true);
  });
});

describe("SignalExtraction", () => {
  const parse = (findings: unknown[]) => SignalExtractionSchema.safeParse({ findings });
  it("accepts facts, inferences with a basis, unknowns and contradictions with two sources", () => {
    expect(
      parse([
        finding(),
        finding({
          key: "f2",
          kind: "inference",
          statement: "Onboarding is probably slow.",
          supportingText: undefined,
          basisKeys: ["f1"],
          extractionConfidence: "low",
        }),
        {
          key: "f3",
          kind: "unknown",
          topic: "budget",
          statement: "No budget is stated.",
          extractionConfidence: "low",
        },
        finding({
          key: "f4",
          kind: "contradiction",
          secondSourceFetchId: "fetch-2",
          statement: "Sources disagree.",
        }),
      ]).success,
    ).toBe(true);
  });
  it("rejects an inference without a basis, a contradiction with one source, and a fact without a quote or source", () => {
    expect(parse([finding({ kind: "inference", supportingText: undefined })]).success).toBe(false);
    expect(parse([finding({ kind: "contradiction" })]).success).toBe(false);
    expect(
      parse([finding({ kind: "contradiction", secondSourceFetchId: "fetch-1" })]).success,
    ).toBe(false);
    expect(parse([finding({ supportingText: undefined })]).success).toBe(false);
    expect(parse([finding({ sourceFetchId: undefined })]).success).toBe(false);
  });
  it("rejects reasoning fields, evidence statuses, numeric confidence and over-long text", () => {
    for (const extra of [
      { reasoning: "step by step" },
      { chain_of_thought: "..." },
      { evidenceStatus: "observed" },
      { evidenceStatus: "buyer_confirmed" },
    ]) {
      expect(parse([finding(extra)]).success).toBe(false);
    }
    expect(parse([finding({ extractionConfidence: 0.9 })]).success).toBe(false);
    expect(parse([finding({ statement: "x".repeat(501) })]).success).toBe(false);
    expect(parse([finding({ supportingText: "x".repeat(241) })]).success).toBe(false);
    expect(SignalExtractionSchema.safeParse({ findings: [], reasoning: "x" }).success).toBe(false);
  });
  it("knows the five protected topics", () => {
    expect([...PROTECTED_TOPICS]).toEqual([
      "data_architecture",
      "source_systems",
      "budget",
      "project_status",
      "buying_authority",
    ]);
  });
});

describe("AccountResearchSummary", () => {
  it("requires the structure and rejects extra and numeric fields", () => {
    const ok = fixture("account-research-summary.json");
    expect(AccountResearchSummarySchema.safeParse({ ...ok, score: 0.8 }).success).toBe(false);
    const withoutUnknowns = { ...ok };
    delete withoutUnknowns["unknowns"];
    expect(AccountResearchSummarySchema.safeParse(withoutUnknowns).success).toBe(false);
  });
});

describe("AccountHypothesis proposals", () => {
  const ok = fixture("account-hypothesis-proposals.json") as {
    proposals: Record<string, unknown>[];
  };
  const withProposal = (over: Record<string, unknown>) =>
    AccountHypothesisProposalsSchema.safeParse({ proposals: [{ ...ok.proposals[0], ...over }] });
  it("needs a supporting finding, a band with an explanation, and bounded text", () => {
    expect(withProposal({}).success).toBe(true);
    expect(withProposal({ supportingFindingKeys: [] }).success).toBe(false);
    expect(withProposal({ confidence: { band: "high" } }).success).toBe(false);
    expect(withProposal({ confidence: { band: 0.9, explanation: "x" } }).success).toBe(false);
    expect(withProposal({ confidence: { band: "medium", explanation: "ab" } }).success).toBe(false);
    expect(withProposal({ statement: "short" }).success).toBe(false);
    expect(withProposal({ statement: "x".repeat(501) }).success).toBe(false);
    expect(withProposal({ reasoning: "x" }).success).toBe(false);
  });
});

describe("ProblemInterpretation", () => {
  const ok = fixture("problem-interpretation.json") as {
    matches: unknown[];
    discoveryQuestions: string[];
    unknowns: string[];
  };
  it("bounds reasons and questions and refuses numeric bands", () => {
    expect(
      ProblemInterpretationSchema.safeParse({
        ...ok,
        matches: [{ capabilityKey: "x", band: 0.7, reason: "r" }],
      }).success,
    ).toBe(false);
    expect(
      ProblemInterpretationSchema.safeParse({
        ...ok,
        matches: [{ capabilityKey: "x", band: "low", reason: "r".repeat(301) }],
      }).success,
    ).toBe(false);
    expect(
      ProblemInterpretationSchema.safeParse({ ...ok, discoveryQuestions: ["q".repeat(301)] })
        .success,
    ).toBe(false);
    expect(ProblemInterpretationSchema.safeParse({ ...ok, thinking: "x" }).success).toBe(false);
  });
});

describe("registry and JSON Schema export", () => {
  it("registers each schema with an id and a version", () => {
    expect(Object.keys(SCHEMA_REGISTRY).sort()).toEqual([
      "account-hypothesis-proposals",
      "account-research-summary",
      "problem-interpretation",
      "signal-extraction",
    ]);
    for (const entry of Object.values(SCHEMA_REGISTRY))
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("exports stable JSON Schemas with no reasoning property", () => {
    const first = exportJsonSchemas();
    expect(JSON.stringify(first)).toBe(JSON.stringify(exportJsonSchemas()));
    expect(JSON.stringify(first)).not.toMatch(/reasoning|chain_of_thought|thinking/);
    for (const [id, schema] of Object.entries(first))
      expect((schema as { type?: string }).type, id).toBe("object");
  });
});
