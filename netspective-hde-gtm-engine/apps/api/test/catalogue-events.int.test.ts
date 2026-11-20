import { describe, expect, it } from "vitest";
import { FEATURE005_EVENT_PAYLOADS } from "@gtm/domain";
import {
  buildCatalogueHarness,
  COMPLETE_PATCH,
  type CatalogueHarness,
} from "../test-support/catalogue-harness.js";

// Task T056, modelled on research-events.int.test.ts: each of the six events is emitted exactly once per
// change with identifiers only; refusals and audit-only changes emit nothing (spec FR-029).
const FEATURE_EVENTS = Object.keys(FEATURE005_EVENT_PAYLOADS);
const featureEventCount = (h: CatalogueHarness) =>
  h.count("outbox_event", `type IN (${FEATURE_EVENTS.map((t) => `'${t}'`).join(",")})`);

describe("emitted once per change", () => {
  it("capability.updated for edit, evidence, link and public_status, with the change type only", () => {
    const h = buildCatalogueHarness();
    h.capabilities.update(h.actor("lead"), "capability-01", {
      lockNo: 1,
      attributes: { name: "Private name" },
    });
    h.capabilities.addEvidence(h.actor("lead"), "capability-01", {
      basisKind: "delivery_record",
      reference: "rec-private",
    });
    h.capabilities.link(h.actor("lead"), "capability-01", "offer-1");
    h.makeCapabilityPublic("capability-02");
    const changes = h.outbox("capability.updated").map((e) => [e["capability_id"], e["change"]]);
    expect(changes.slice(0, 3)).toEqual([
      ["capability-01", "edit"],
      ["capability-01", "evidence"],
      ["capability-01", "link"],
    ]);
    expect(changes.filter(([, c]) => c === "public_status")).toEqual([
      ["capability-02", "public_status"],
    ]);
    for (const e of h.outbox("capability.updated"))
      expect(Object.keys(e).sort()).toEqual(["capability_id", "change"]);
    expect(h.anyText(/Private name|rec-private/)).toBe(false);
  });

  it("offer.updated for version, status, limitation and score with the version and status", () => {
    const h = buildCatalogueHarness();
    h.offers.createVersion(
      h.actor("lead"),
      "offer-7",
      { patch: COMPLETE_PATCH, reason: "Complete" },
      1,
    );
    h.offerStatus.moveStatus(h.actor("lead"), "offer-7", 2, "internally_reviewed", "ok");
    h.limitations.changeWording(
      h.actor("lead"),
      "limitation-offer-7-evaluation",
      "A different wording here",
    );
    h.scores.addCriterion(h.actor("lead"), { key: "pull", label: "Buyer pull", position: 1 });
    h.scores.setScore(h.actor("lead"), { offerId: "offer-7", criterionKey: "pull", score: 3 });
    expect(
      h.outbox("offer.updated").map((e) => [e["change"], e["version_no"], e["status"]]),
    ).toEqual([
      ["version", 2, "draft"],
      ["status", 2, "internally_reviewed"],
      ["limitation", 2, "internally_reviewed"],
      ["score", 2, "internally_reviewed"],
    ]);
    for (const e of h.outbox("offer.updated"))
      expect(Object.keys(e).sort()).toEqual(["change", "offer_id", "status", "version_no"]);
  });

  it("offer.capacity.changed with the period kind and limit", () => {
    const h = buildCatalogueHarness();
    h.capacity.setLimit(h.actor("lead"), "offer-6", {
      periodKind: "week",
      limitSessions: 2,
      reason: "Private reason",
    });
    expect(h.outbox("offer.capacity.changed")).toEqual([
      { offer_id: "offer-6", period_kind: "week", limit_sessions: 2 },
    ]);
    expect(h.anyText(/Private reason/)).toBe(false);
  });

  it("claim.created and claim.reviewed, and claim.needs_review from the job", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), {
      text: "We reduced rejections by 40% last year.",
    });
    h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "document",
      reference: "doc",
      owner: "Owner",
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    h.claimReview.review(h.actor("lead"), c.id, { decision: "approve", note: "Checked" });
    h.claimReview.review(h.actor("marketing"), c.id, { decision: "approve", note: "Checked too" });
    expect(h.outbox("claim.created")).toEqual([
      { claim_id: c.id, effective_class: "quantified_outcome" },
    ]);
    expect(h.outbox("claim.reviewed").map((e) => e["claim_status"])).toEqual([
      "in_review",
      "approved",
    ]);
    h.advanceDays(30);
    h.claimStaleness.apply({ userId: null, actorType: "system", correlationId: null, now: h.now });
    expect(h.outbox("claim.needs_review")).toEqual([{ claim_id: c.id }]);
  });

  it("validates every emitted payload against its strict schema", () => {
    const h = buildCatalogueHarness();
    h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "month", limitSessions: 5 });
    h.claims.draft(h.actor("drafter"), { text: "We review feeds." });
    h.capabilities.link(h.actor("lead"), "capability-01", "offer-1");
    h.offers.createVersion(
      h.actor("lead"),
      "offer-4",
      { patch: { name: "A" }, reason: "Reason" },
      1,
    );
    for (const [type, schema] of Object.entries(FEATURE005_EVENT_PAYLOADS)) {
      for (const payload of h.outbox(type))
        expect(schema.safeParse(payload).success, type).toBe(true);
    }
  });
});

describe("not emitted", () => {
  it("for a refused action", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.offers.createVersion(
        h.actor("analyst"),
        "offer-2",
        { patch: { name: "A" }, reason: "Reason" },
        1,
      ),
    ).toThrow();
    expect(() =>
      h.offerStatus.moveStatus(h.actor("lead"), "offer-2", 1, "available", "skip"),
    ).toThrow();
    expect(() => h.claims.draft(h.actor("drafter"), { text: "Call 123-45-6789 first" })).toThrow();
    expect(() =>
      h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "month", limitSessions: -1 }),
    ).toThrow();
    expect(featureEventCount(h)).toBe(0);
  });

  it("for audit-only changes: bookings, deliverables, claim evidence, withdrawal, dispositions and the phrase list", () => {
    const h = buildCatalogueHarness();
    const b = h.bookings.record(h.actor("lead"), "offer-6", { sessionDate: "2026-11-20" });
    h.bookings.cancel(h.actor("lead"), b.id);
    const t = h.paidTypes.proposeDeliverable(h.actor("lead"), "input_audit", {
      text: "A weekly status call",
    });
    h.paidTypes.decideDeliverable(
      h.actor("lead"),
      "input_audit",
      t.deliverables.find((d) => d.text === "A weekly status call")!.id,
      { decision: "approve", note: "Agreed" },
    );
    h.paidTypes.update(h.actor("lead"), "input_audit", { lockNo: 1, scope: ["one use case"] });
    const draft = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds weekly." });
    const afterDraft = featureEventCount(h);
    h.claims.addEvidence(h.actor("drafter"), draft.id, {
      kind: "document",
      reference: "doc-1",
      owner: "Owner",
    });
    h.claimReview.withdraw(h.actor("drafter"), draft.id, { note: "Not needed" });
    h.claimReview.markFalsePositive(h.actor("lead"), {
      sentence: "A SOC 2 reading list.",
      ruleId: "soc2",
      reason: "Reading list",
    });
    h.claimReview.publishPhraseList(h.actor("marketing"), {
      rules: h.claimReview.getPhraseList(h.actor("admin")).rules,
      reviewerId: "lead-1",
      note: "No change",
    });
    expect(featureEventCount(h)).toBe(afterDraft);
    expect(afterDraft).toBe(1);
  });

  it("with any claim, offer, note, wording or example text in any payload", () => {
    const h = buildCatalogueHarness();
    h.claims.draft(h.actor("drafter"), { text: "Distinctive claim sentence one." });
    h.offers.createVersion(
      h.actor("lead"),
      "offer-4",
      { patch: { name: "Distinctive offer name" }, reason: "Distinctive reason" },
      1,
    );
    h.capabilities.addExample(h.actor("lead"), "capability-01", {
      text: "Distinctive example text",
    });
    h.limitations.changeWording(
      h.actor("lead"),
      "limitation-offer-7-evaluation",
      "Distinctive wording here",
    );
    expect(h.anyText(/Distinctive/)).toBe(false);
    expect(featureEventCount(h)).toBeGreaterThan(0);
  });
});
