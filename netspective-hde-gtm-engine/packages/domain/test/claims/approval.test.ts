import { describe, expect, it } from "vitest";
import {
  effectiveClass,
  evaluateClaimApproval,
  hasValidEvidence,
  type ApprovalInput,
} from "../../src/index.js";

// Task T018: the pure approval rule. Restricted claims need valid evidence and two different designated
// approvers who did not draft the claim; any rejection stops a claim; general claims need one approval.
const NOW = "2026-11-19T10:00:00.000Z";
const FUTURE = "2027-11-19T00:00:00.000Z";
const PAST = "2026-11-01T00:00:00.000Z";
const base: ApprovalInput = {
  draftedBy: "drafter",
  effectiveClass: "quantified_outcome",
  evidence: [{ withdrawn: false, expiresAt: FUTURE }],
  priorReviews: [],
  reviewerId: "a1",
  decision: "approve",
  now: NOW,
};
const run = (over: Partial<ApprovalInput> = {}) => evaluateClaimApproval({ ...base, ...over });

describe("effectiveClass", () => {
  it("is the declared class when it is restricted", () => {
    expect(effectiveClass("ai_ready", [])).toBe("ai_ready");
    expect(effectiveClass("ai_ready", ["sla_rto"])).toBe("ai_ready");
  });
  it("is never lower than what the checker finds", () => {
    expect(effectiveClass(null, ["sla_rto"])).toBe("sla_rto");
    expect(effectiveClass("general", ["certification"])).toBe("certification");
  });
  it("is general only when nothing restricted is declared or found", () => {
    expect(effectiveClass(null, [])).toBe("general");
    expect(effectiveClass("general", [])).toBe("general");
  });
  it("takes the first found class in the fixed class order when several are found", () => {
    expect(effectiveClass(null, ["ai_ready", "quantified_outcome"])).toBe("quantified_outcome");
  });
});

describe("hasValidEvidence", () => {
  it("needs at least one item that is not withdrawn and not past its expiry", () => {
    expect(hasValidEvidence([], NOW)).toBe(false);
    expect(hasValidEvidence([{ withdrawn: true, expiresAt: FUTURE }], NOW)).toBe(false);
    expect(hasValidEvidence([{ withdrawn: false, expiresAt: PAST }], NOW)).toBe(false);
    expect(hasValidEvidence([{ withdrawn: false, expiresAt: NOW }], NOW)).toBe(false);
    expect(
      hasValidEvidence(
        [
          { withdrawn: true, expiresAt: FUTURE },
          { withdrawn: false, expiresAt: FUTURE },
        ],
        NOW,
      ),
    ).toBe(true);
  });
});

describe("restricted claim", () => {
  it("is refused without valid evidence, with a suggestion to omit", () => {
    for (const evidence of [
      [],
      [{ withdrawn: true, expiresAt: FUTURE }],
      [{ withdrawn: false, expiresAt: PAST }],
    ]) {
      const r = run({ evidence });
      expect(r).toMatchObject({ ok: false, codes: ["claim_needs_evidence"] });
      expect(r.ok ? "" : r.suggestion).toMatch(/omit/i);
    }
  });

  it("stays in review after the first approval and needs a second approver", () => {
    expect(run()).toEqual({
      ok: true,
      status: "in_review",
      approvals: 1,
      needed: 2,
      pending: ["second_approver_required"],
    });
  });

  it("is approved by a second, different approver", () => {
    expect(
      run({ priorReviews: [{ reviewerId: "a1", decision: "approve" }], reviewerId: "a2" }),
    ).toEqual({
      ok: true,
      status: "approved",
      approvals: 2,
      needed: 2,
      pending: [],
    });
  });

  it("does not count the same reviewer twice", () => {
    expect(
      run({ priorReviews: [{ reviewerId: "a1", decision: "approve" }], reviewerId: "a1" }),
    ).toMatchObject({
      ok: false,
      codes: ["already_reviewed"],
    });
  });

  it("refuses the drafter, for approval and for rejection", () => {
    expect(run({ reviewerId: "drafter" })).toMatchObject({
      ok: false,
      codes: ["drafter_cannot_approve"],
    });
    expect(run({ reviewerId: "drafter", decision: "reject" })).toMatchObject({
      ok: false,
      codes: ["drafter_cannot_approve"],
    });
  });

  it("is stopped by any rejection, and nothing is approved after it", () => {
    expect(run({ decision: "reject" })).toMatchObject({ ok: true, status: "rejected" });
    expect(
      run({
        priorReviews: [{ reviewerId: "a1", decision: "reject" }],
        reviewerId: "a2",
      }),
    ).toMatchObject({ ok: false, codes: ["rejected"] });
  });

  it("can be rejected without evidence (omission is the default)", () => {
    expect(run({ evidence: [], decision: "reject" })).toMatchObject({
      ok: true,
      status: "rejected",
    });
  });
});

describe("general claim", () => {
  const general = { effectiveClass: "general" as const };
  it("needs valid evidence and one approval", () => {
    expect(run({ ...general, evidence: [] })).toMatchObject({
      ok: false,
      codes: ["claim_needs_evidence"],
    });
    expect(run({ ...general })).toEqual({
      ok: true,
      status: "approved",
      approvals: 1,
      needed: 1,
      pending: [],
    });
  });
  it("still refuses its drafter", () => {
    expect(run({ ...general, reviewerId: "drafter" })).toMatchObject({
      ok: false,
      codes: ["drafter_cannot_approve"],
    });
  });
});
