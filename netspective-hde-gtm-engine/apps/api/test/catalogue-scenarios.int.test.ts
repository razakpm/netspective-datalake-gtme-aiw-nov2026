import { describe, expect, it } from "vitest";
import { buildCatalogueHarness, COMPLETE_PATCH } from "../test-support/catalogue-harness.js";

// Task T076: cross-feature scenarios E (claims governance) and G (capacity) from
// docs/context/04-acceptance-scenarios.md, over synthetic content only.
const DRAFT =
  "Our platform is AI-ready. We offer an SLA and are SOC 2 compliant. In our case study we cut rejections by 40%.";

describe("Scenario E: claims governance", () => {
  it("flags AI-ready, an SLA, SOC 2 and a case-study figure, and cannot be approved without a claim and evidence", () => {
    const h = buildCatalogueHarness();
    const flagged = h.claims.lint(h.actor("analyst"), DRAFT).matches;
    expect(flagged.map((m) => m.rule).sort()).toEqual(
      ["ai-ready", "case-study", "outcome-percentage", "sla", "soc2"].sort(),
    );
    expect(flagged.every((m) => !m.covered)).toBe(true);

    h.offers.createVersion(
      h.actor("lead"),
      "offer-2",
      { patch: { ...COMPLETE_PATCH, landingPagePromise: DRAFT }, reason: "Draft promise" },
      1,
    );
    h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "internally_reviewed", "ok");
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go")).toThrow(
      /restricted wording/i,
    );

    const claim = h.claims.draft(h.actor("drafter"), { text: DRAFT });
    expect(claim.restricted).toBe(true);
    expect(() =>
      h.claimReview.review(h.actor("lead"), claim.id, { decision: "approve", note: "Looks fine" }),
    ).toThrow(/Omit the statement/);
    expect(h.claims.get(h.actor("lead"), claim.id).suggestion).toMatch(/Omit the statement/);
  });
});

describe("Scenario G: capacity", () => {
  it("reads exhausted when Offer 6 is full for the month, so routing can pick an alternative, and clears on cancellation", () => {
    const h = buildCatalogueHarness();
    const ids = ["2026-11-20", "2026-11-24", "2026-11-27"].map(
      (d) => h.bookings.record(h.actor("lead"), "offer-6", { sessionDate: d }).id,
    );
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "exhausted",
      limit: 3,
      used: 3,
      remaining: 0,
    });
    h.bookings.cancel(h.actor("lead"), ids[0]!);
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "room",
      remaining: 1,
    });
    expect(h.capacity.capacityStatus("offer-1", h.now()).state).toBe("room");
  });
});
