import { describe, expect, it } from "vitest";
import { buildCatalogueHarness, type CatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T052: a claim that lapses is flagged wherever it is used (spec FR-008). The check is made when the
// offer or capability is read, with identifiers only, and nothing is stored by the read.
const PROMISE = "We are SOC 2 compliant.";

function offerWithClaim(h: CatalogueHarness, evidenceExpiresAt = "2027-01-01T00:00:00.000Z") {
  const claimId = h.insertApprovedClaim(PROMISE, { expiresAt: evidenceExpiresAt });
  h.approveOffer("offer-2", { landingPagePromise: PROMISE });
  return claimId;
}
const cover = (h: CatalogueHarness) => h.offers.get(h.actor("lead"), "offer-2").claimCover;

describe("offer claim cover", () => {
  it("is ok, naming the covering claim, while the claim is approved with valid evidence", () => {
    const h = buildCatalogueHarness();
    const claimId = offerWithClaim(h);
    expect(cover(h)).toEqual({ status: "ok", claimIds: [claimId], ruleIds: [] });
  });

  it("is ok with nothing to name when the public text has no restricted phrase, and for a baseline offer", () => {
    const h = buildCatalogueHarness();
    h.approveOffer("offer-2");
    expect(cover(h)).toEqual({ status: "ok", claimIds: [], ruleIds: [] });
    expect(h.offers.get(h.actor("lead"), "offer-1").claimCover).toEqual({
      status: "ok",
      claimIds: [],
      ruleIds: [],
    });
  });

  it("lapses, with claim and rule identifiers only, when the evidence expires", () => {
    const h = buildCatalogueHarness();
    const claimId = offerWithClaim(h, "2026-12-15T00:00:00.000Z");
    expect(cover(h).status).toBe("ok");
    h.advanceDays(40);
    expect(cover(h)).toEqual({ status: "lapsed", claimIds: [claimId], ruleIds: ["soc2"] });
    expect(JSON.stringify(cover(h))).not.toContain("SOC 2");
    expect(h.offers.list(h.actor("lead")).find((o) => o.id === "offer-2")?.claimCover.status).toBe(
      "lapsed",
    );
    expect(h.offers.get(h.actor("lead"), "offer-2").status).toBe("approved");
  });

  it("lapses when the claim's evidence is withdrawn, and clears when valid evidence returns", () => {
    const h = buildCatalogueHarness();
    const claimId = offerWithClaim(h);
    h.db.raw
      .prepare(
        "UPDATE claim_evidence SET withdrawn_at = ?, withdrawn_by = 'lead-1' WHERE claim_id = ?",
      )
      .run(h.now().toISOString(), claimId);
    expect(cover(h)).toMatchObject({ status: "lapsed", claimIds: [claimId] });
    h.db.raw
      .prepare(
        "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES ('ev-new', ?, 'document', 'doc-2', 'owner', 'lead-1', ?, '2028-01-01T00:00:00.000Z')",
      )
      .run(claimId, h.now().toISOString());
    expect(cover(h)).toEqual({ status: "ok", claimIds: [claimId], ruleIds: [] });
  });

  it("lapses when the claim is withdrawn", () => {
    const h = buildCatalogueHarness();
    const claimId = offerWithClaim(h);
    h.claimReview.withdraw(h.actor("lead"), claimId, { note: "Retired statement" });
    expect(cover(h)).toMatchObject({ status: "lapsed", claimIds: [claimId], ruleIds: ["soc2"] });
  });

  it("stores nothing when read: no audit record, no event and the claim row is unchanged", () => {
    const h = buildCatalogueHarness();
    const claimId = offerWithClaim(h, "2026-12-15T00:00:00.000Z");
    h.advanceDays(40);
    const before = [h.count("audit_event"), h.count("outbox_event")];
    cover(h);
    cover(h);
    expect([h.count("audit_event"), h.count("outbox_event")]).toEqual(before);
    expect(h.db.raw.prepare("SELECT status FROM claim WHERE id = ?").get(claimId)).toEqual({
      status: "approved",
    });
  });
});

describe("capability claim cover", () => {
  it("shows publicClaimNeedsReview when the linked claim's evidence lapses, and clears it with new evidence", () => {
    const h = buildCatalogueHarness();
    h.makeCapabilityPublic("capability-01");
    const claimId = h.capabilities.get(h.actor("lead"), "capability-01").publicClaimId!;
    expect(h.capabilities.get(h.actor("lead"), "capability-01").publicClaimNeedsReview).toBe(false);
    h.db.raw
      .prepare(
        "UPDATE claim_evidence SET withdrawn_at = ?, withdrawn_by = 'lead-1' WHERE claim_id = ?",
      )
      .run(h.now().toISOString(), claimId);
    expect(h.capabilities.get(h.actor("lead"), "capability-01").publicClaimNeedsReview).toBe(true);
    expect(h.capabilities.publicView()).toEqual([]);
    h.db.raw
      .prepare(
        "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES ('ev-new', ?, 'document', 'doc-2', 'owner', 'lead-1', ?, '2028-01-01T00:00:00.000Z')",
      )
      .run(claimId, h.now().toISOString());
    expect(h.capabilities.get(h.actor("lead"), "capability-01").publicClaimNeedsReview).toBe(false);
  });
});
