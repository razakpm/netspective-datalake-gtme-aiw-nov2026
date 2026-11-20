import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T045: offer scores are judgements labelled hypothesis, with history (quickstart V22; FR-027).
describe("offer scores", () => {
  it("starts empty with no criteria", () => {
    const h = buildCatalogueHarness();
    expect(h.scores.list(h.actor("analyst"))).toEqual({ criteria: [], scores: [] });
  });

  it("records a score as a hypothesis, keeps history and shows the latest as current", () => {
    const h = buildCatalogueHarness();
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    h.scores.setScore(h.actor("lead"), {
      offerId: "offer-1",
      criterionKey: "buyer_pull",
      score: 3,
      rationale: "Early signs",
    });
    h.advance(1000);
    h.scores.setScore(h.actor("lead"), {
      offerId: "offer-1",
      criterionKey: "buyer_pull",
      score: 4,
    });
    const { scores } = h.scores.list(h.actor("analyst"));
    expect(scores).toEqual([
      expect.objectContaining({
        offerId: "offer-1",
        criterionKey: "buyer_pull",
        score: 4,
        status: "hypothesis",
        setBy: "lead-1",
      }),
    ]);
    expect(
      h.scores.history(h.actor("analyst"), "offer-1", "buyer_pull").map((s) => s.score),
    ).toEqual([3, 4]);
  });

  it("refuses a score outside the configured scale and a non-integer", () => {
    const h = buildCatalogueHarness();
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    for (const score of [0, 6, -1, 2.5]) {
      expect(
        () =>
          h.scores.setScore(h.actor("lead"), {
            offerId: "offer-1",
            criterionKey: "buyer_pull",
            score,
          }),
        String(score),
      ).toThrow();
    }
    for (const score of [1, 5])
      h.scores.setScore(h.actor("lead"), { offerId: "offer-1", criterionKey: "buyer_pull", score });
    expect(h.count("offer_score")).toBe(2);
  });

  it("refuses an unknown criterion or offer and cannot set a status other than hypothesis", () => {
    const h = buildCatalogueHarness();
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    expect(() =>
      h.scores.setScore(h.actor("lead"), { offerId: "offer-1", criterionKey: "nope", score: 3 }),
    ).toThrow(/not found/i);
    expect(() =>
      h.scores.setScore(h.actor("lead"), {
        offerId: "offer-99",
        criterionKey: "buyer_pull",
        score: 3,
      }),
    ).toThrow(/not found/i);
    expect(() =>
      h.scores.setScore(h.actor("lead"), {
        offerId: "offer-1",
        criterionKey: "buyer_pull",
        score: 3,
        status: "confirmed",
      }),
    ).toThrow(/Invalid fields/);
  });

  it("needs offers.edit and refuses PHI-like rationales", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.scores.addCriterion(h.actor("analyst"), {
        key: "buyer_pull",
        label: "Buyer pull",
        position: 1,
      }),
    ).toThrow(/permission/);
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    expect(() =>
      h.scores.setScore(h.actor("analyst"), {
        offerId: "offer-1",
        criterionKey: "buyer_pull",
        score: 3,
      }),
    ).toThrow(/permission/);
    expect(() =>
      h.scores.setScore(h.actor("lead"), {
        offerId: "offer-1",
        criterionKey: "buyer_pull",
        score: 3,
        rationale: "See 123-45-6789",
      }),
    ).toThrow();
    expect(h.count("offer_score")).toBe(0);
  });

  it("emits offer.updated with the change type score and audits it", () => {
    const h = buildCatalogueHarness();
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    h.scores.setScore(h.actor("lead"), {
      offerId: "offer-1",
      criterionKey: "buyer_pull",
      score: 3,
      rationale: "Secret rationale text",
    });
    expect(h.outbox("offer.updated")).toEqual([
      { offer_id: "offer-1", version_no: 1, change: "score", status: "approved" },
    ]);
    expect(h.audit("offer.score.set")).toHaveLength(1);
    expect(h.anyText(/Secret rationale text/)).toBe(false);
  });

  it("is refused by the database when a score is updated or deleted", () => {
    const h = buildCatalogueHarness();
    h.scores.addCriterion(h.actor("lead"), { key: "buyer_pull", label: "Buyer pull", position: 1 });
    h.scores.setScore(h.actor("lead"), {
      offerId: "offer-1",
      criterionKey: "buyer_pull",
      score: 3,
    });
    expect(() => h.db.raw.prepare("UPDATE offer_score SET score = 5").run()).toThrow(/append-only/);
    expect(() => h.db.raw.prepare("DELETE FROM offer_score").run()).toThrow(/append-only/);
  });
});
