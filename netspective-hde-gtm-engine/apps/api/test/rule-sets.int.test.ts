import { RULE_SET_V1 } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { buildOffersHarness } from "../test-support/offers-harness.js";

// Task T032 (quickstart V14): versioned rule sets, activation gated by the case corpus.
const codesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (e) {
    return (e as { codes?: string[] }).codes ?? [];
  }
  return [];
};
const v1 = () => structuredClone(RULE_SET_V1);
const broken = () => {
  const set = v1();
  set.rules = set.rules.map((r) =>
    r.id === "icp1-onboarding-friction"
      ? { ...r, then: { offerKey: "pilot-input-trace-workshop" } }
      : r,
  );
  return set;
};

describe("routing rule set versions", () => {
  it("seeds version 1 as the active, readable rule set", () => {
    const h = buildOffersHarness();
    expect(h.rules.active()).toMatchObject({ version: 1, state: "active", author: "seed" });
    expect(h.rules.list(h.actor("operator")).map((r) => r.version)).toEqual([1]);
  });

  it("creates a draft with its author and reason, without changing the active version", () => {
    const h = buildOffersHarness();
    const lead = h.actor("lead");
    const draft = h.rules.createDraft(lead, { rules: v1(), reason: "Tune thresholds" });
    expect(draft).toMatchObject({
      version: 2,
      state: "draft",
      author: "lead-1",
      reason: "Tune thresholds",
    });
    expect(h.rules.active().version).toBe(1);
    expect(h.audit("routing.rules.create")).toHaveLength(1);
  });

  it("refuses an invalid rule set, a short reason and PHI-like text", () => {
    const h = buildOffersHarness();
    const lead = h.actor("lead");
    expect(
      codesOf(() => h.rules.createDraft(lead, { rules: { rules: [] }, reason: "Because" })),
    ).toContain("rules_invalid");
    expect(() => h.rules.createDraft(lead, { rules: v1(), reason: "ab" })).toThrow();
    expect(
      codesOf(() => h.rules.createDraft(lead, { rules: v1(), reason: "Patient SSN 123-45-6789" })),
    ).toContain("phi_guard");
    expect(h.count("routing_rule_set")).toBe(1);
  });

  it("activates a draft that passes the corpus, retires the previous version and keeps it readable", () => {
    const h = buildOffersHarness();
    const lead = h.actor("lead");
    const draft = h.rules.createDraft(lead, { rules: v1(), reason: "No change, to test" });
    const active = h.rules.activate(lead, draft.version, {
      reason: "Approved after the corpus passed",
    });
    expect(active).toMatchObject({ version: 2, state: "active", activatedBy: "lead-1" });
    expect(active.testsPassedAt).not.toBeNull();
    expect(h.rules.byVersion(1)?.state).toBe("retired");
    expect(h.rules.active().version).toBe(2);
    expect(h.audit("routing.rules.activate")).toHaveLength(1);
  });

  it("refuses to activate a rule set that fails a corpus case and leaves it a draft", () => {
    const h = buildOffersHarness();
    const lead = h.actor("lead");
    const draft = h.rules.createDraft(lead, { rules: broken(), reason: "Experimental change" });
    expect(
      codesOf(() => h.rules.activate(lead, draft.version, { reason: "Trying it anyway" })),
    ).toContain("rules_tests_failed");
    expect(h.rules.byVersion(draft.version)?.state).toBe("draft");
    expect(h.rules.active().version).toBe(1);
    expect(h.audit("routing.rules.activate.refused").at(-1)?.outcome).toBe("denied");
  });

  it("refuses to activate a version that is not a draft", () => {
    const h = buildOffersHarness();
    expect(
      codesOf(() => h.rules.activate(h.actor("lead"), 1, { reason: "Again please" })),
    ).toContain("not_a_draft");
    expect(
      codesOf(() => h.rules.activate(h.actor("lead"), 99, { reason: "Unknown one" })),
    ).toContain("unknown_rule_set");
  });

  it("needs routing.rules.manage: an operator and an analyst are refused with an audited refusal", () => {
    const h = buildOffersHarness();
    for (const who of ["operator", "analyst", "marketing"] as const) {
      expect(
        codesOf(() => h.rules.createDraft(h.actor(who), { rules: v1(), reason: "Try to change" })),
      ).toContain("forbidden");
    }
    expect(h.count("routing_rule_set")).toBe(1);
    expect(h.audit("routing.rules.create.refused")).toHaveLength(3);
  });

  it("records the version on every recommendation, so a new version applies from its activation", async () => {
    const h = buildOffersHarness();
    const lead = h.actor("lead");
    const o = h.org("northvale", [["sender_onboarding_friction", "observed"]]);
    h.hypothesis(o.id, "onboarding_friction");
    const first = await h.recommendations.recommend(h.actor("operator"), { accountId: o.id });
    h.rules.activate(
      lead,
      h.rules.createDraft(lead, { rules: v1(), reason: "Same rules again" }).version,
      { reason: "Corpus passed" },
    );
    h.recommendations.dismiss(h.actor("operator"), first.id, { reason: "Superseded" });
    const second = await h.recommendations.recommend(h.actor("operator"), { accountId: o.id });
    expect(first.ruleSetVersion).toBe(1);
    expect(second.ruleSetVersion).toBe(2);
    expect(h.recommendations.get(h.actor("operator"), first.id).ruleSetVersion).toBe(1);
  });
});
