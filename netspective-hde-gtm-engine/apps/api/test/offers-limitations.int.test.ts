import { describe, expect, it } from "vitest";
import { buildCatalogueHarness, COMPLETE_PATCH } from "../test-support/catalogue-harness.js";

// Task T030: limitations, the placeholder gate and restricted text (quickstart V12 to V14; spec FR-012,
// FR-013, FR-014, SC-003).
const SEVEN = "offer-7";
const LIMITATION = "limitation-offer-7-evaluation";

function offer7ReadyForApproval(h: ReturnType<typeof buildCatalogueHarness>) {
  h.offers.createVersion(h.actor("lead"), SEVEN, { patch: COMPLETE_PATCH, reason: "Complete" }, 1);
  h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "internally_reviewed", "Reviewed");
}

describe("Offer 7's limitation", () => {
  it("blocks approval until a service lead acknowledges it, then allows it", () => {
    const h = buildCatalogueHarness();
    offer7ReadyForApproval(h);
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "approved", "Go")).toThrow(
      /limitation[^]*not acknowledged|not acknowledged[^]*evaluation_is_buyer_prompt_only/i,
    );
    expect(h.audit("offer.status.move.refused")[0]?.after_summary).toContain(
      "limitation_unacknowledged",
    );
    expect(h.offers.get(h.actor("lead"), SEVEN).status).toBe("internally_reviewed");

    const ack = h.limitations.acknowledge(h.actor("lead"), LIMITATION);
    expect(ack).toMatchObject({
      acknowledged: true,
      acknowledgedBy: "lead-1",
      acknowledgementStale: false,
    });
    expect(h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "approved", "Go").status).toBe(
      "approved",
    );
  });

  it("records who acknowledged, when and the wording hash", () => {
    const h = buildCatalogueHarness();
    h.limitations.acknowledge(h.actor("lead"), LIMITATION);
    const row = h.db.raw.prepare("SELECT * FROM offer_limitation_ack").get() as Record<
      string,
      string
    >;
    expect(row).toMatchObject({
      limitation_id: LIMITATION,
      acknowledged_by: "lead-1",
      acknowledged_at: h.now().toISOString(),
    });
    expect(row["wording_hash"]).toMatch(/^[0-9a-f]{64}$/);
    expect(h.audit("offer.limitation.acknowledge")).toHaveLength(1);
  });

  it("needs offers.limitations.acknowledge and refuses everyone else", () => {
    const h = buildCatalogueHarness();
    for (const who of ["analyst", "operator", "marketing", "executive"] as const) {
      expect(() => h.limitations.acknowledge(h.actor(who), LIMITATION), who).toThrow(/permission/);
    }
    expect(h.count("offer_limitation_ack")).toBe(0);
  });

  it("makes the acknowledgement stale when the wording changes and refuses the next move until repeated", () => {
    const h = buildCatalogueHarness();
    offer7ReadyForApproval(h);
    h.limitations.acknowledge(h.actor("lead"), LIMITATION);
    h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "approved", "Go");
    expect(h.offers.get(h.actor("lead"), SEVEN)).toMatchObject({
      status: "approved",
      acknowledgementStale: false,
    });

    h.limitations.changeWording(
      h.actor("lead"),
      LIMITATION,
      "Evaluation is a buyer prompt only, never a result",
    );
    expect(h.offers.get(h.actor("lead"), SEVEN)).toMatchObject({
      status: "approved",
      inForceVersionNo: 2,
      acknowledgementStale: true,
    });
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "available", "Live")).toThrow(
      /not acknowledged/i,
    );

    h.limitations.acknowledge(h.actor("lead"), LIMITATION);
    expect(h.offers.get(h.actor("lead"), SEVEN).acknowledgementStale).toBe(false);
    expect(h.offerStatus.moveStatus(h.actor("lead"), SEVEN, 2, "available", "Live").status).toBe(
      "available",
    );
  });

  it("needs offers.edit to change the wording and writes an offer.updated event without the wording", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.limitations.changeWording(h.actor("analyst"), LIMITATION, "Another wording here"),
    ).toThrow(/permission/);
    h.limitations.changeWording(h.actor("lead"), LIMITATION, "Another wording here");
    expect(h.outbox("offer.updated").map((e) => e["change"])).toEqual(["limitation"]);
    expect(h.anyText(/Another wording here|buyer prompt/)).toBe(false);
  });
});

describe("placeholder attributes", () => {
  it("allows review of a blank offer but refuses approval, listing the missing fields", () => {
    const h = buildCatalogueHarness();
    h.offerStatus.moveStatus(h.actor("lead"), "offer-3", 1, "internally_reviewed", "Look");
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), "offer-3", 1, "approved", "Go")).toThrow(
      /still to be provided[^]*name, format, targetIcp/,
    );
    expect(h.audit("offer.status.move.refused")[0]?.after_summary).toContain(
      "placeholder_attributes",
    );
  });

  it("refuses to make a baseline offer available while its attributes are incomplete", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.offerStatus.moveStatus(h.actor("lead"), "offer-1", 1, "available", "Live"),
    ).toThrow(/still to be provided/);
  });
});

describe("restricted text in public fields", () => {
  const withPromise = (h: ReturnType<typeof buildCatalogueHarness>, promise: string) => {
    h.offers.createVersion(
      h.actor("lead"),
      "offer-2",
      { patch: { ...COMPLETE_PATCH, landingPagePromise: promise }, reason: "Promise" },
      1,
    );
    h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "internally_reviewed", "ok");
  };

  it("refuses approval while a restricted phrase is not covered, then allows it once an approved claim covers the exact sentence", () => {
    const h = buildCatalogueHarness();
    withPromise(h, "We are SOC 2 compliant.");
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go")).toThrow(
      /restricted wording[^]*landingPagePromise/i,
    );
    const audit = h.audit("offer.status.move.refused")[0]?.after_summary ?? "";
    expect(audit).toContain("uncovered_restricted_phrase");
    expect(audit).not.toMatch(/SOC 2 compliant/);
    h.insertApprovedClaim("We are SOC 2 compliant.");
    expect(h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go").status).toBe(
      "approved",
    );
  });

  it("does not accept a claim that only covers part of the sentence or whose evidence expired", () => {
    const h = buildCatalogueHarness();
    withPromise(h, "We are SOC 2 compliant and proud.");
    h.insertApprovedClaim("SOC 2 compliant");
    h.insertApprovedClaim("We are SOC 2 compliant and proud.", {
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go")).toThrow(
      /restricted wording/i,
    );
  });

  it("checks every public field, so a phrase in the call to action is caught too", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(
      h.actor("lead"),
      "offer-2",
      { patch: { ...COMPLETE_PATCH, cta: "Get our guaranteed plan" }, reason: "cta" },
      1,
    );
    h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "internally_reviewed", "ok");
    expect(() => h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go")).toThrow(
      /cta/,
    );
  });

  it("does not check fields that are not public", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(
      h.actor("lead"),
      "offer-2",
      { patch: { ...COMPLETE_PATCH, buyerEffort: "An SLA-free hour" }, reason: "effort" },
      1,
    );
    h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "internally_reviewed", "ok");
    expect(h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 2, "approved", "Go").status).toBe(
      "approved",
    );
  });
});
