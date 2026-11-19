import { describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";

// Task T047: the stale rule and flags with an injectable clock (quickstart V16).
const A = ACCOUNTS;
const DAY = 86_400_000;
const setup = () => {
  const h = buildResearchHarness();
  const sys = { userId: null, actorType: "system" as const, correlationId: null, now: h.now };
  return { h, sys };
};
const make = (h: ReturnType<typeof buildResearchHarness>, signalIds: string[]) =>
  h.hypotheses.create(h.actor(), A.northvale.id, {
    statement: "Sender onboarding delays may be slowing multi-format intake.",
    category: "onboarding_friction",
    supportingSignalIds: signalIds,
    confidence: { band: "low", explanation: "Early evidence only." },
  }).id;
const advance = (h: ReturnType<typeof buildResearchHarness>, days: number) => {
  h.clock.now = new Date(h.clock.now.getTime() + days * DAY);
};

describe("staleness", () => {
  it("is stale 90 days after the supporting signals stopped counting, by rule, with a system decision and the right event", () => {
    const { h, sys } = setup();
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.", {
      publishedAt: h.now().toISOString(),
    });
    h.approve(s.id);
    const id = make(h, [s.id]);
    expect(h.hypotheses.get(id).effectiveStatus).toBe("untested");
    // The onboarding_delay window is 180 days; the signal stops counting at 180 days, then 90 more days pass.
    advance(h, 180 + 89);
    expect(h.hypotheses.get(id)).toMatchObject({ status: "untested", effectiveStatus: "untested" });
    advance(h, 1);
    expect(h.hypotheses.get(id)).toMatchObject({ status: "untested", effectiveStatus: "stale" });
    expect(h.staleness.apply(sys)).toMatchObject({ staled: 1 });
    const view = h.hypotheses.get(id);
    expect(view).toMatchObject({ status: "stale", effectiveStatus: "stale" });
    expect(view.statusHistory.at(-1)).toMatchObject({
      toStatus: "stale",
      decidedByType: "system",
      decidedBy: null,
      reasonCode: "no_current_evidence",
    });
    expect(h.count("audit_event", "action = 'hypothesis.stale'")).toBe(1);
    const ev = h.db.raw
      .prepare(
        "SELECT payload FROM outbox_event WHERE type = 'hypothesis.updated' ORDER BY rowid DESC",
      )
      .get() as { payload: string };
    expect(JSON.parse(ev.payload)).toMatchObject({ change: "stale", status: "stale" });
    expect(h.staleness.apply(sys)).toEqual({ staled: 0, flagged: 0 });
  });
  it("counts a hypothesis with only pending signals from its acceptance, and gives the same answer without the job", () => {
    const { h } = setup();
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const id = make(h, [s.id]);
    advance(h, 89);
    expect(h.hypotheses.get(id).effectiveStatus).toBe("untested");
    advance(h, 1);
    expect(h.hypotheses.get(id).effectiveStatus).toBe("stale");
    expect(h.hypotheses.list(A.northvale.id, {}).items[0]!.effectiveStatus).toBe("stale");
  });
  it("lets a reviewer revive a stale hypothesis, which restarts the window", () => {
    const { h, sys } = setup();
    const s = h.signal(A.northvale.id, "Senders report onboarding delays.");
    const id = make(h, [s.id]);
    advance(h, 95);
    h.staleness.apply(sys);
    expect(h.hypotheses.get(id).status).toBe("stale");
    h.hypothesisReview.changeStatus(
      h.reviewer(),
      id,
      "weakening",
      "Revived: a reviewer is re-checking the sources.",
    );
    expect(h.hypotheses.get(id)).toMatchObject({
      status: "weakening",
      effectiveStatus: "weakening",
    });
    advance(h, 89);
    expect(h.hypotheses.get(id).effectiveStatus).toBe("weakening");
    advance(h, 2);
    expect(h.hypotheses.get(id).effectiveStatus).toBe("stale");
  });
  it("never stales a validated or rejected hypothesis, but flags it when its supporting signal is rejected", () => {
    const { h, sys } = setup();
    const bc = h.signal(A.northvale.id, "The buyer confirmed the delays.", {
      source: { sourceId: "default-source-buyer_statement", ref: "call-1" },
      evidenceStatus: "buyer_confirmed",
    });
    h.approve(bc.id);
    advance(h, 1);
    const id = make(h, [bc.id]);
    advance(h, 1);
    h.hypothesisReview.changeStatus(
      h.reviewer(),
      id,
      "validated",
      "Buyer confirmed and a reviewer approved.",
    );
    advance(h, 1);
    h.signalReview.review(h.reviewer(), bc.id, {
      decision: "reject",
      reason: "The buyer corrected the statement.",
    });
    expect(h.hypotheses.get(id)).toMatchObject({
      status: "validated",
      flaggedForReview: true,
      flagReason: "supporting_signal_rejected",
    });
    advance(h, 400);
    expect(h.staleness.apply(sys)).toMatchObject({ staled: 0 });
    expect(h.hypotheses.get(id)).toMatchObject({
      status: "validated",
      effectiveStatus: "validated",
    });
    expect(
      h.db.raw
        .prepare("SELECT flagged_for_review, flag_reason FROM account_hypothesis WHERE id = ?")
        .get(id),
    ).toEqual({ flagged_for_review: 1, flag_reason: "supporting_signal_rejected" });
  });
  it("flags when a supporting signal goes stale or is contradicted, only when something changed after the last review", () => {
    const { h, sys } = setup();
    const a = h.signal(A.northvale.id, "Senders report onboarding delays.", {
      publishedAt: h.now().toISOString(),
    });
    const b = h.signal(A.northvale.id, "Another source says onboarding is fast.", {
      publishedAt: h.now().toISOString(),
    });
    h.approve(a.id);
    h.approve(b.id);
    advance(h, 1);
    const id = make(h, [a.id]);
    expect(h.staleness.apply(sys)).toEqual({ staled: 0, flagged: 0 });
    advance(h, 1);
    h.signalReview.review(h.reviewer(), a.id, {
      decision: "contradict",
      contradictsSignalId: b.id,
    });
    expect(h.hypotheses.get(id)).toMatchObject({
      flaggedForReview: true,
      flagReason: "supporting_signal_contradicted",
    });
    expect(h.staleness.apply(sys)).toMatchObject({ flagged: 1 });
    expect(
      h.count("outbox_event", "type = 'hypothesis.updated' AND payload LIKE '%\"flag\"%'"),
    ).toBe(1);
    expect(h.staleness.apply(sys)).toEqual({ staled: 0, flagged: 0 });
  });
});
