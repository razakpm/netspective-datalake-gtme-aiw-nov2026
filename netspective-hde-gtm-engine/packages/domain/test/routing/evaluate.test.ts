import { describe, expect, it } from "vitest";
import corpus from "../../src/routing/corpus.json" with { type: "json" };
import { evaluate } from "../../src/routing/evaluate.js";
import { RULE_SET_V1, parseRuleSet, type RuleSet } from "../../src/routing/rules.js";
import { runCorpus, type Corpus } from "../../src/routing/corpus.js";
import { DEFAULT_ROUTING_CONFIG, type RoutingContext } from "../../src/routing/types.js";

const data = corpus as unknown as Corpus;

describe("the routing case corpus", () => {
  it("passes against rule set version 1", () => {
    const result = runCorpus(RULE_SET_V1, 1, data);
    expect(result.failures).toEqual([]);
    expect(result.total).toBe(data.cases.length);
  });

  it("covers every v1 rule with a match, a near-miss and a precedence case (SC-008)", () => {
    for (const rule of RULE_SET_V1.rules) {
      const own = data.cases.filter((c) => c.rule === rule.id);
      expect(
        own.some((c) => c.kind === "match"),
        `${rule.id} match`,
      ).toBe(true);
      expect(
        own.some((c) => c.kind === "near_miss"),
        `${rule.id} near_miss`,
      ).toBe(true);
    }
    // Precedence cases name the rule that lost; every rule that can lose has one.
    const precedence = data.cases.filter((c) => c.kind === "precedence");
    expect(precedence.length).toBeGreaterThanOrEqual(4);
  });

  it("covers every eligibility code", () => {
    const codes = new Set(
      data.cases.flatMap((c) => c.expected.excluded.map((e) => e.split(":")[1])),
    );
    for (const code of [
      "account_excluded",
      "fit_not_priority",
      "contact_suppressed",
      "no_communication_permission",
      "offer_unavailable",
      "capacity_exhausted",
    ]) {
      expect(codes.has(code), code).toBe(true);
    }
  });

  it("fails a rule set that breaks a case", () => {
    const broken: RuleSet = {
      rules: RULE_SET_V1.rules.map((r) =>
        r.id === "icp1-onboarding-friction"
          ? { ...r, then: { offerKey: "pilot-input-trace-workshop" } }
          : r,
      ),
    };
    const result = runCorpus(broken, 2, data);
    expect(result.failures.length).toBeGreaterThan(0);
    expect(result.failures.join(" ")).toContain("r1-match-onboarding");
  });
});

const base = data.base as unknown as RoutingContext;
const run = (patch: Partial<RoutingContext>, set: RuleSet = RULE_SET_V1) =>
  evaluate({ ...base, ...patch }, set, 1, DEFAULT_ROUTING_CONFIG);

describe("evaluate", () => {
  it("is deterministic: the same inputs and version give the same result (FR-006)", () => {
    const ctx = {
      ...base,
      hypotheses: [
        {
          id: "h1",
          category: "onboarding_friction",
          capabilities: [],
          acceptance: "accepted" as const,
          effectiveStatus: "strengthening" as const,
          band: "medium" as const,
          currentSupportingSignals: 1,
        },
      ],
    };
    const a = evaluate(ctx, RULE_SET_V1, 1, DEFAULT_ROUTING_CONFIG);
    const b = evaluate(structuredClone(ctx), RULE_SET_V1, 1, DEFAULT_ROUTING_CONFIG);
    expect(b).toEqual(a);
    expect(a.ruleSetVersion).toBe(1);
  });

  it("breaks a priority tie by rule id and lists every match", () => {
    const set: RuleSet = {
      rules: [
        {
          id: "b-rule",
          priority: 10,
          description: "second by id",
          when: { icp: "icp1" },
          then: { offerKey: "ccda-to-fhir-mapping-decision-register" },
        },
        {
          id: "a-rule",
          priority: 10,
          description: "first by id",
          when: { icp: "icp1" },
          then: { offerKey: "pilot-input-trace-workshop" },
        },
        {
          id: "fallback",
          priority: 90,
          description: "fallback",
          when: { fallback: true },
          then: { byFit: true },
        },
      ],
    };
    const r = run({}, set);
    expect(r.matched.map((m) => m.ruleId)).toEqual(["a-rule", "b-rule"]);
    expect(r.chosenRuleId).toBe("a-rule");
    expect(r.offerKey).toBe("pilot-input-trace-workshop");
  });

  it("never lets a blocked account or contact reach a rule", () => {
    const r = run({ contact: { ...base.contact!, suppressed: true } });
    expect(r.matched).toEqual([]);
    expect(r.outreach).toEqual({ allowed: false, reasons: ["contact_suppressed"] });
  });

  it("does not mutate its input", () => {
    const ctx = structuredClone(base);
    const before = JSON.stringify(ctx);
    evaluate(ctx, RULE_SET_V1, 1, DEFAULT_ROUTING_CONFIG);
    expect(JSON.stringify(ctx)).toBe(before);
  });
});

describe("the rule set schema", () => {
  it("accepts version 1", () => {
    expect(parseRuleSet(RULE_SET_V1).ok).toBe(true);
  });
  it.each([
    [
      "an unknown condition",
      {
        rules: [
          {
            id: "x-rule",
            priority: 1,
            description: "abc",
            when: { colour: "red" },
            then: { outcome: "research" },
          },
        ],
      },
    ],
    ["a missing result", { rules: [{ id: "x-rule", priority: 1, description: "abc", when: {} }] }],
    [
      "a non-integer priority",
      {
        rules: [
          {
            id: "x-rule",
            priority: 1.5,
            description: "abc",
            when: {},
            then: { outcome: "research" },
          },
        ],
      },
    ],
    [
      "a bad rule id",
      {
        rules: [
          {
            id: "X Rule",
            priority: 1,
            description: "abc",
            when: {},
            then: { outcome: "research" },
          },
        ],
      },
    ],
    ["no rules", { rules: [] }],
    [
      "a duplicate rule id",
      {
        rules: [
          {
            id: "x-rule",
            priority: 1,
            description: "abc",
            when: {},
            then: { outcome: "research" },
          },
          {
            id: "x-rule",
            priority: 2,
            description: "abc",
            when: {},
            then: { outcome: "research" },
          },
        ],
      },
    ],
    [
      "two fallback rules",
      {
        rules: [
          {
            id: "x-rule",
            priority: 1,
            description: "abc",
            when: { fallback: true },
            then: { byFit: true },
          },
          {
            id: "y-rule",
            priority: 2,
            description: "abc",
            when: { fallback: true },
            then: { byFit: true },
          },
        ],
      },
    ],
  ])("rejects %s", (_name, doc) => {
    expect(parseRuleSet(doc).ok).toBe(false);
  });
});
