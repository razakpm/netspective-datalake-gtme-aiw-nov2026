import { describe, expect, it } from "vitest";
import {
  applyRegulatoryRules,
  classifyFunding,
  evaluateReview,
  externalUseAnswer,
} from "../../src/index.js";

describe("funding", () => {
  const f = (over = {}) =>
    classifyFunding({
      typeKey: "budget_approval_statement",
      typeKind: "funding",
      evidenceStatus: "observed",
      ...over,
    });
  it("defaults funding types to context and other types to none", () => {
    expect(f()).toEqual({ ok: true, fundingClass: "context", approvalCitation: null });
    expect(
      classifyFunding({ typeKey: "x", typeKind: "general", evidenceStatus: "observed" }),
    ).toMatchObject({ fundingClass: "none" });
    expect(
      classifyFunding({
        typeKey: "x",
        typeKind: "general",
        evidenceStatus: "observed",
        requested: "context",
      }),
    ).toEqual({ ok: false, code: "funding_class_not_allowed" });
  });
  it("allows budget-approval evidence only with a cited statement from stated evidence", () => {
    expect(f({ requested: "budget_approval_evidence" })).toEqual({
      ok: false,
      code: "approval_citation_required",
    });
    expect(f({ requested: "budget_approval_evidence", approvalCitation: " " })).toEqual({
      ok: false,
      code: "approval_citation_required",
    });
    expect(
      f({
        requested: "budget_approval_evidence",
        approvalCitation: "Board approved $1M on 2026-10-01",
      }),
    ).toMatchObject({ ok: true, fundingClass: "budget_approval_evidence" });
    expect(
      f({
        requested: "budget_approval_evidence",
        approvalCitation: "x",
        evidenceStatus: "ai_hypothesis",
      }),
    ).toEqual({ ok: false, code: "approval_needs_stated_evidence" });
  });
  it("never lets a grant announcement be budget-approval evidence", () => {
    expect(
      f({
        typeKey: "grant_funding_announcement",
        requested: "budget_approval_evidence",
        approvalCitation: "x",
      }),
    ).toEqual({ ok: false, code: "grant_announcement_is_context_only" });
  });
});

describe("regulatory", () => {
  const r = (over = {}) =>
    applyRegulatoryRules({
      typeKind: "regulatory",
      observation: "CMS-0057-F API deadline",
      ...over,
    });
  it("makes category H signals context-only with the re-verify flag", () => {
    expect(r()).toEqual({
      ok: true,
      regulatoryStatus: "unverified",
      contextOnly: true,
      reverifyRequired: true,
    });
    expect(r({ requestedStatus: "reported_final" })).toMatchObject({
      ok: true,
      regulatoryStatus: "reported_final",
      reverifyRequired: true,
    });
  });
  it("never records HTI-5 as final", () => {
    expect(r({ observation: "HTI-5 rule text", requestedStatus: "reported_final" })).toEqual({
      ok: false,
      code: "hti5_never_final",
    });
    expect(r({ regulatoryItem: "hti 5", requestedStatus: "reported_final" })).toEqual({
      ok: false,
      code: "hti5_never_final",
    });
    expect(r({ observation: "HTI-5 proposal", requestedStatus: "proposed" })).toMatchObject({
      ok: true,
    });
  });
  it("refuses a regulatory status on other types and answers the external-use check", () => {
    expect(
      applyRegulatoryRules({ typeKind: "general", observation: "x", requestedStatus: "proposed" }),
    ).toEqual({ ok: false, code: "regulatory_status_not_allowed" });
    expect(externalUseAnswer({ contextOnly: true, reverifyRequired: true })).toBe(
      "not_without_reverification",
    );
    expect(externalUseAnswer({ contextOnly: true, reverifyRequired: false })).toBe("context_only");
  });
});

describe("review rules", () => {
  const ctx = (over = {}) => ({
    status: "pending" as const,
    newProvenanceFlag: false,
    reverifyRequired: false,
    ...over,
  });
  const e = (decision: Parameters<typeof evaluateReview>[1]["decision"], c = ctx(), extra = {}) =>
    evaluateReview(c, { decision, signalId: "s1", ...extra });
  it("approves and rejects with the right transitions", () => {
    expect(e("approve")).toEqual({ ok: true, nextStatus: "approved" });
    expect(e("approve", ctx({ status: "approved" }))).toMatchObject({ ok: false });
    expect(e("approve", ctx({ status: "rejected" }))).toEqual({ ok: true, nextStatus: "approved" });
    expect(e("reject")).toEqual({ ok: false, code: "reason_required" });
    expect(e("reject", ctx(), { reason: "ab" })).toEqual({ ok: false, code: "reason_required" });
    expect(e("reject", ctx({ status: "approved" }), { reason: "stale source" })).toEqual({
      ok: true,
      nextStatus: "rejected",
    });
  });
  it("needs another signal to contradict", () => {
    expect(e("contradict")).toEqual({ ok: false, code: "contradicted_signal_required" });
    expect(e("contradict", ctx(), { contradictsSignalId: "s1" })).toEqual({
      ok: false,
      code: "cannot_contradict_itself",
    });
    expect(e("contradict", ctx(), { contradictsSignalId: "s2" })).toEqual({
      ok: true,
      nextStatus: "contradictory",
    });
  });
  it("re-verifies only flagged signals with a reason and clears only a set flag", () => {
    expect(e("reverify", ctx({ reverifyRequired: true }))).toEqual({
      ok: false,
      code: "reason_required",
    });
    expect(e("reverify", ctx(), { reason: "checked" })).toEqual({
      ok: false,
      code: "nothing_to_reverify",
    });
    expect(
      e("reverify", ctx({ reverifyRequired: true, status: "approved" }), {
        reason: "checked source",
      }),
    ).toEqual({ ok: true, nextStatus: "approved" });
    expect(e("clear_flag")).toEqual({ ok: false, code: "no_flag_to_clear" });
    expect(e("clear_flag", ctx({ newProvenanceFlag: true, status: "approved" }))).toEqual({
      ok: true,
      nextStatus: "approved",
    });
  });
});
