import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T058: the optional daily job announces a lapsed claim once; nothing depends on it (reads compute it).
const system = (h: ReturnType<typeof buildCatalogueHarness>) => ({
  userId: null,
  actorType: "system" as const,
  correlationId: null,
  now: h.now,
});

describe("claims.staleness", () => {
  it("announces an approved claim whose evidence has lapsed, once, with the claim id only", () => {
    const h = buildCatalogueHarness();
    const live = h.insertApprovedClaim("We review sender feeds.");
    const lapsing = h.insertApprovedClaim("We map CCDA fields.", {
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(0);
    h.advanceDays(30);
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(1);
    expect(h.outbox("claim.needs_review")).toEqual([{ claim_id: lapsing }]);
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(0);
    expect(h.outbox("claim.needs_review")).toHaveLength(1);
    expect(h.claims.get(h.actor("lead"), live).status).toBe("approved");
    expect(h.audit("claim.needs_review").map((a) => [a.actor_id, a.entity_id])).toEqual([
      [null, lapsing],
    ]);
  });

  it("does not store a status: the claim row is unchanged and reads still compute needs_review", () => {
    const h = buildCatalogueHarness();
    const id = h.insertApprovedClaim("We map CCDA fields.", {
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    h.advanceDays(30);
    h.claimStaleness.apply(system(h));
    expect(h.db.raw.prepare("SELECT status FROM claim WHERE id = ?").get(id)).toEqual({
      status: "approved",
    });
    expect(h.claims.get(h.actor("lead"), id).status).toBe("needs_review");
  });

  it("announces again when valid evidence returns and then lapses a second time", () => {
    const h = buildCatalogueHarness();
    const id = h.insertApprovedClaim("We map CCDA fields.", {
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    h.advanceDays(30);
    h.claimStaleness.apply(system(h));
    h.db.raw
      .prepare(
        "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES ('ev-2', ?, 'document', 'doc-2', 'owner', 'lead-1', ?, '2027-03-01T00:00:00.000Z')",
      )
      .run(id, h.now().toISOString());
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(0);
    h.advanceDays(120);
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(1);
    expect(h.outbox("claim.needs_review")).toHaveLength(2);
  });

  it("ignores claims that are not approved", () => {
    const h = buildCatalogueHarness();
    h.claims.draft(h.actor("drafter"), { text: "We review sender feeds." });
    h.advanceDays(400);
    expect(h.claimStaleness.apply(system(h)).flagged).toBe(0);
  });
});
