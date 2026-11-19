import { describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";

// Task T065: research and hypotheses leave features 002 and 003 alone, and work with their records.
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
const TABLES = [
  "account",
  "account_classification",
  "account_domain",
  "icp_definition",
  "icp_fit_assessment",
  "exclusion_override",
  "suppression_record",
  "contact",
  "account_contact_relationship",
  "evidence_reference",
  "review_item",
];
const snapshot = (h: ReturnType<typeof buildResearchHarness>) =>
  JSON.stringify(TABLES.map((t) => h.db.raw.prepare(`SELECT * FROM ${t}`).all()));

describe("compatibility with features 002 and 003", () => {
  it("changes no account, fit, eligibility, suppression or evidence record through a run, proposals, hypotheses and review", async () => {
    const h = buildResearchHarness({ scenario: "northvale", withProposals: true });
    const before = snapshot(h);
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const proposalId = h.hypotheses.list(A.northvale.id, { acceptance: "proposed" }).items[0]!.id;
    h.hypotheses.accept(h.actor(), proposalId);
    h.hypothesisReview.changeStatus(
      h.reviewer(),
      proposalId,
      "strengthening",
      "The two observations agree.",
    );
    expect(snapshot(h)).toBe(before);
    expect(h.count("icp_fit_assessment")).toBe(0);
  });
  it("lets a signal a reviewer approves after the hand-off count as current evidence for a hypothesis, and flags it when rejected", async () => {
    const h = buildResearchHarness({ scenario: "northvale", withProposals: true });
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const proposal = h.hypotheses.list(A.northvale.id, { acceptance: "proposed" }).items[0]!;
    const accepted = h.hypotheses.accept(h.actor(), proposal.id);
    expect(accepted.supporting.every((s) => s.reviewStatus === "pending" && !s.isCurrent)).toBe(
      true,
    );
    const first = accepted.supporting[0]!.signalId;
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    h.approve(first);
    expect(
      h.hypotheses.get(proposal.id).supporting.find((s) => s.signalId === first),
    ).toMatchObject({ reviewStatus: "approved", isCurrent: true });
    h.clock.now = new Date(h.clock.now.getTime() + 1000);
    h.signalReview.review(h.reviewer(), first, {
      decision: "reject",
      reason: "The source was withdrawn.",
    });
    expect(h.hypotheses.get(proposal.id)).toMatchObject({
      flaggedForReview: true,
      status: "untested",
    });
  });
  it("keeps the original account reference on research history when an account is merged into another", async () => {
    const h = buildResearchHarness({ scenario: "northvale" });
    const run = await h.runFor(A.northvale.id, [SENDERS]);
    h.db.raw
      .prepare("UPDATE account SET merged_into = ? WHERE id = ?")
      .run(A.riverbend.id, A.northvale.id);
    expect(
      h.db.raw.prepare("SELECT account_id FROM research_run WHERE id = ?").get(run.id),
    ).toEqual({ account_id: A.northvale.id });
    expect(h.service.list({ accountId: A.northvale.id }).items.map((r) => r.id)).toEqual([run.id]);
    expect(h.service.list({ accountId: A.riverbend.id }).items.map((r) => r.id)).toEqual([run.id]);
    const started = h.service.startRun(h.actor(), A.northvale.id, {
      sources: [{ address: SENDERS }],
    });
    expect(started.accountId).toBe(A.riverbend.id);
    expect(h.service.accountSummary(A.riverbend.id).runId).toBe(run.id);
  });
  it("lets feature 003's own evidence rules stand: research cannot approve a signal, set buyer-confirmed or raise reliability", async () => {
    const h = buildResearchHarness({ scenario: "northvale" });
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(h.count("signal", "review_status <> 'pending'")).toBe(0);
    expect(h.count("signal", "evidence_status IN ('observed','buyer_confirmed')")).toBe(0);
    expect(h.count("signal", "reliability_overridden_by IS NOT NULL")).toBe(0);
    expect(h.count("signal_review")).toBe(0);
  });
});
