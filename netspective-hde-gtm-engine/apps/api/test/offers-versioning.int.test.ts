import { describe, expect, it } from "vitest";
import { buildCatalogueHarness, COMPLETE_PATCH } from "../test-support/catalogue-harness.js";
import { snapshotHash } from "@gtm/db";

// Task T029: seeded catalogue, immutable versions, per-version status and optimistic concurrency
// (quickstart V8 to V11, V27; spec FR-009 to FR-011, SC-004).
const lead = (h: ReturnType<typeof buildCatalogueHarness>) => h.actor("lead");

describe("seeded catalogue", () => {
  it("reads Offers 1, 5 and 6 approved with the baseline notice and the rest draft", () => {
    const h = buildCatalogueHarness();
    const offers = h.offers.list(lead(h));
    expect(offers.map((o) => o.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const o of offers) {
      const baseline = [1, 5, 6].includes(o.number);
      expect(o.status, `offer ${o.number}`).toBe(baseline ? "approved" : "draft");
      expect(o.baselineIncomplete, `offer ${o.number}`).toBe(baseline);
      expect(o.inForceVersionNo).toBe(baseline ? 1 : null);
    }
  });

  it("is readable by anyone with offers.read, and not by a caller without it", () => {
    const h = buildCatalogueHarness();
    expect(h.offers.list(h.actor("analyst"))).toHaveLength(10);
    expect(() => h.offers.list({ ...h.actor("analyst"), permissions: [] })).toThrow(/permission/);
  });

  it("shows the effort estimate as a hypothesis on every version", () => {
    const h = buildCatalogueHarness();
    for (const o of h.offers.list(lead(h))) {
      expect(h.offers.getVersion(lead(h), o.id, 1).snapshot.effortEstimate.status).toBe(
        "hypothesis",
      );
    }
  });
});

describe("versions are immutable", () => {
  it("creates a new draft version and leaves the earlier version and its hash unchanged", () => {
    const h = buildCatalogueHarness();
    const before = h.offers.getVersion(lead(h), "offer-1", 1);
    const head = h.offers.get(lead(h), "offer-1");
    const v2 = h.offers.createVersion(
      lead(h),
      "offer-1",
      { patch: { cta: "Book a session" }, reason: "Add the call to action" },
      head.lockNo,
    );
    expect(v2).toMatchObject({ versionNo: 2, status: "draft", superseded: false });
    expect(v2.snapshot.cta).toBe("Book a session");
    expect(v2.snapshot.name).toBe("Sender Onboarding Friction Map");
    const after = h.offers.getVersion(lead(h), "offer-1", 1);
    expect(after).toEqual({ ...before, superseded: false });
    expect(after.snapshotHash).toBe(before.snapshotHash);
    expect(snapshotHash(after.snapshot)).toBe(after.snapshotHash);
  });

  it("keeps the approved version in force while the new one is reviewed", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(lead(h), "offer-1", { patch: { cta: "Book" }, reason: "Edit" }, 1);
    const summary = h.offers.get(lead(h), "offer-1");
    expect(summary).toMatchObject({
      status: "approved",
      inForceVersionNo: 1,
      latestVersionNo: 2,
      latestStatus: "draft",
      lockNo: 2,
    });
    expect(
      h.offers.listVersions(lead(h), "offer-1").map((v) => [v.versionNo, v.status, v.superseded]),
    ).toEqual([
      [1, "approved", false],
      [2, "draft", false],
    ]);
  });

  it("reads an earlier version as superseded once a later one is approved", () => {
    const h = buildCatalogueHarness();
    h.approveOffer("offer-1");
    const versions = h.offers.listVersions(lead(h), "offer-1");
    expect(versions.map((v) => [v.versionNo, v.status, v.superseded])).toEqual([
      [1, "approved", true],
      [2, "approved", false],
    ]);
    expect(h.offers.get(lead(h), "offer-1").inForceVersionNo).toBe(2);
    expect(
      h.db.raw
        .prepare(
          "SELECT status FROM offer_version_status WHERE offer_id='offer-1' AND version_no=1 ORDER BY rowid DESC LIMIT 1",
        )
        .get(),
    ).toEqual({ status: "approved" });
  });

  it("reads every earlier version back exactly as saved after many later changes", () => {
    const h = buildCatalogueHarness();
    const saved = h.offers.getVersion(lead(h), "offer-3", 1);
    for (let i = 0; i < 5; i++) {
      const head = h.offers.get(lead(h), "offer-3");
      h.offers.createVersion(
        lead(h),
        "offer-3",
        { patch: { name: `Name ${i}` }, reason: `Change ${i}` },
        head.lockNo,
      );
    }
    expect(h.offers.getVersion(lead(h), "offer-3", 1)).toEqual(saved);
    expect(h.offers.listVersions(lead(h), "offer-3")).toHaveLength(6);
  });

  it("is refused by the database when a version or status row is updated or deleted", () => {
    const h = buildCatalogueHarness();
    for (const sql of [
      "UPDATE offer_version SET reason = 'x' WHERE offer_id = 'offer-1'",
      "DELETE FROM offer_version WHERE offer_id = 'offer-1'",
      "UPDATE offer_version_status SET status = 'draft' WHERE offer_id = 'offer-1'",
      "DELETE FROM offer_version_status WHERE offer_id = 'offer-1'",
    ]) {
      expect(() => h.db.raw.prepare(sql).run(), sql).toThrow(/append-only/);
    }
  });

  it("refuses a change made on a stale lock number with 409", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(lead(h), "offer-4", { patch: { name: "A" }, reason: "First" }, 1);
    expect(() =>
      h.offers.createVersion(lead(h), "offer-4", { patch: { name: "B" }, reason: "Second" }, 1),
    ).toThrow(/reload/i);
    expect(h.offers.listVersions(lead(h), "offer-4")).toHaveLength(2);
    expect(h.audit("offer.version.create.refused")).toHaveLength(1);
  });

  it("needs offers.edit, refuses PHI-like text and unknown fields, and stores nothing when refused", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.offers.createVersion(
        h.actor("analyst"),
        "offer-4",
        { patch: { name: "A" }, reason: "Reason" },
        1,
      ),
    ).toThrow(/permission/);
    expect(() =>
      h.offers.createVersion(
        lead(h),
        "offer-4",
        { patch: { buyerOutput: "Call 123-45-6789 first" }, reason: "Reason" },
        1,
      ),
    ).toThrow();
    expect(() =>
      h.offers.createVersion(lead(h), "offer-4", { patch: { price: "10" }, reason: "Reason" }, 1),
    ).toThrow(/Invalid fields/);
    expect(() =>
      h.offers.createVersion(
        lead(h),
        "offer-4",
        { patch: { effortEstimate: { text: "x", status: "confirmed" } }, reason: "Reason" },
        1,
      ),
    ).toThrow(/Invalid fields/);
    expect(h.offers.listVersions(lead(h), "offer-4")).toHaveLength(1);
    expect(h.anyText(/123-45-6789/)).toBe(false);
  });

  it("writes one audit record and one offer.updated event per version, identifiers only", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(
      lead(h),
      "offer-4",
      { patch: { name: "Secret name text" }, reason: "Reason text here" },
      1,
    );
    expect(h.audit("offer.version.create").map((a) => [a.actor_id, a.entity_id])).toEqual([
      ["lead-1", "offer-4"],
    ]);
    expect(h.outbox("offer.updated")).toEqual([
      { offer_id: "offer-4", version_no: 2, change: "version", status: "draft" },
    ]);
    expect(h.anyText(/Secret name text|Reason text here/)).toBe(false);
  });
});

describe("status moves", () => {
  it("follows the order and records who and when, with the in-force pointer moving on approval", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(lead(h), "offer-2", { patch: COMPLETE_PATCH, reason: "Complete" }, 1);
    h.advance(1000);
    const reviewed = h.offerStatus.moveStatus(
      lead(h),
      "offer-2",
      2,
      "internally_reviewed",
      "Looks right",
    );
    expect(reviewed.status).toBe("internally_reviewed");
    expect(h.offers.get(lead(h), "offer-2").inForceVersionNo).toBeNull();
    h.advance(1000);
    const approved = h.offerStatus.moveStatus(lead(h), "offer-2", 2, "approved", "Go");
    expect(approved.status).toBe("approved");
    expect(h.offers.get(lead(h), "offer-2")).toMatchObject({
      inForceVersionNo: 2,
      status: "approved",
    });
    h.advance(1000);
    expect(h.offerStatus.moveStatus(lead(h), "offer-2", 2, "available", "Live").status).toBe(
      "available",
    );
    expect(h.audit("offer.status.move").map((a) => a.actor_id)).toEqual([
      "lead-1",
      "lead-1",
      "lead-1",
    ]);
    expect(h.outbox("offer.updated").map((e) => [e["change"], e["status"]])).toEqual([
      ["version", "draft"],
      ["status", "internally_reviewed"],
      ["status", "approved"],
      ["status", "available"],
    ]);
  });

  it("refuses draft straight to available with a plain reason and audits the refusal", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.offerStatus.moveStatus(lead(h), "offer-2", 1, "available", "Skip ahead"),
    ).toThrow(/cannot move from draft to available/);
    expect(h.audit("offer.status.move.refused")).toHaveLength(1);
    expect(h.audit("offer.status.move.refused")[0]?.after_summary).toContain("invalid_transition");
    expect(h.offers.get(lead(h), "offer-2").status).toBe("draft");
  });

  it("withdraws and expires the in-force version, clearing the pointer, and allows no move after", () => {
    const h = buildCatalogueHarness();
    h.offerStatus.moveStatus(lead(h), "offer-1", 1, "withdrawn", "Retired");
    expect(h.offers.get(lead(h), "offer-1")).toMatchObject({
      status: "withdrawn",
      inForceVersionNo: null,
    });
    expect(() => h.offerStatus.moveStatus(lead(h), "offer-1", 1, "approved", "Back")).toThrow(
      /cannot move/,
    );
    h.offerStatus.moveStatus(lead(h), "offer-6", 1, "expired", "Lapsed");
    expect(h.offers.get(lead(h), "offer-6")).toMatchObject({
      status: "expired",
      inForceVersionNo: null,
    });
  });

  it("refuses a move on a superseded version", () => {
    const h = buildCatalogueHarness();
    h.approveOffer("offer-1");
    expect(() => h.offerStatus.moveStatus(lead(h), "offer-1", 1, "available", "Old one")).toThrow(
      /later version has been approved/,
    );
  });

  it("needs offers.status.change", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.offerStatus.moveStatus(h.actor("analyst"), "offer-2", 1, "internally_reviewed", "ok"),
    ).toThrow(/permission/);
    expect(h.offers.get(lead(h), "offer-2").status).toBe("draft");
  });
});
