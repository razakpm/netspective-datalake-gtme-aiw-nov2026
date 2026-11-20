import { describe, expect, it } from "vitest";
import { checkText } from "../src/modules/claims/index.js";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T049: false-positive dispositions apply to one exact sentence and rule (quickstart V6; FR-007).
const SENTENCE = "Page 50% is where we reduced noise.";
const flagged = (h: ReturnType<typeof buildCatalogueHarness>, text: string) =>
  h.db.transaction((tx) => checkText(tx, text, h.now().toISOString()).matches);

describe("marking a false positive", () => {
  it("is refused for anyone without claims.approve", () => {
    const h = buildCatalogueHarness();
    for (const who of ["analyst", "drafter", "operator", "executive"] as const) {
      expect(
        () =>
          h.claimReview.markFalsePositive(h.actor(who), {
            sentence: "We are SOC 2 compliant.",
            ruleId: "soc2",
            reason: "Quoted text",
          }),
        who,
      ).toThrow(/permission/);
    }
    expect(h.count("lint_disposition")).toBe(0);
  });

  it("is recorded for an approver, covering that exact sentence and rule only", () => {
    const h = buildCatalogueHarness();
    const sentence = "Our SOC 2 reading list is public.";
    expect(flagged(h, sentence).map((m) => m.covered)).toEqual([false]);
    const id = h.claimReview.markFalsePositive(h.actor("lead"), {
      sentence,
      ruleId: "soc2",
      reason: "A reading list, not a claim",
    });
    expect(id).toMatch(/\S/);
    expect(flagged(h, sentence).map((m) => m.covered)).toEqual([true]);
    expect(flagged(h, "Our SOC 2 reading list is public and long.").map((m) => m.covered)).toEqual([
      false,
    ]);
    expect(flagged(h, "We are SOC 2 compliant.").map((m) => m.covered)).toEqual([false]);
    const row = h.db.raw.prepare("SELECT * FROM lint_disposition").get() as Record<string, string>;
    expect(row).toMatchObject({
      rule_id: "soc2",
      reviewer_id: "lead-1",
      decided_at: h.now().toISOString(),
    });
    expect(row["sentence_hash"]).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the sentence after normalisation, so case and spacing do not matter", () => {
    const h = buildCatalogueHarness();
    h.claimReview.markFalsePositive(h.actor("marketing"), {
      sentence: "Our SOC 2 reading list is public.",
      ruleId: "soc2",
      reason: "A reading list",
    });
    expect(flagged(h, "our  soc 2 reading list is public").length).toBe(0);
    expect(flagged(h, "Our SOC 2 reading list is public!").map((m) => m.covered)).toEqual([true]);
  });

  it("is refused when the rule does not flag that sentence, or does not exist", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.claimReview.markFalsePositive(h.actor("lead"), {
        sentence: "We review feeds.",
        ruleId: "soc2",
        reason: "Nothing to see",
      }),
    ).toThrow(/does not flag/i);
    expect(() =>
      h.claimReview.markFalsePositive(h.actor("lead"), {
        sentence: "We are SOC 2 compliant.",
        ruleId: "no-such-rule",
        reason: "Nothing to see",
      }),
    ).toThrow(/does not flag/i);
    expect(h.count("lint_disposition")).toBe(0);
  });

  it("needs a reason of at least three characters and refuses PHI-like text", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.claimReview.markFalsePositive(h.actor("lead"), {
        sentence: "We are SOC 2 compliant.",
        ruleId: "soc2",
        reason: "no",
      }),
    ).toThrow(/Invalid fields/);
    expect(() =>
      h.claimReview.markFalsePositive(h.actor("lead"), {
        sentence: "SOC 2 for 123-45-6789",
        ruleId: "soc2",
        reason: "Quoted",
      }),
    ).toThrow();
    expect(h.count("lint_disposition")).toBe(0);
  });

  it("is audited with the rule and never the sentence, emits no event and cannot be edited or removed", () => {
    const h = buildCatalogueHarness();
    h.claimReview.markFalsePositive(h.actor("lead"), {
      sentence: SENTENCE,
      ruleId: "outcome-percentage",
      reason: "Page number",
    });
    expect(h.audit("claim.disposition").map((a) => a.actor_id)).toEqual(["lead-1"]);
    expect(h.anyText(/Page 50% is where/)).toBe(false);
    expect(h.count("outbox_event")).toBe(0);
    expect(() => h.db.raw.prepare("UPDATE lint_disposition SET reason = 'x'").run()).toThrow(
      /append-only/,
    );
    expect(() => h.db.raw.prepare("DELETE FROM lint_disposition").run()).toThrow(/append-only/);
  });
});
