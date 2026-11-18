import type { SignalKind } from "./taxonomy.js";

// Funding classification (spec FR-035, FR-036; research R-07). A signal is funding context by default;
// it is budget-approval evidence only when the source states an approval and that statement is cited.
// Nothing here, and no column anywhere, expresses a funding path.

export type FundingClass = "none" | "context" | "budget_approval_evidence";

export interface FundingInput {
  typeKey: string;
  typeKind: SignalKind;
  evidenceStatus: string;
  requested?: FundingClass | undefined;
  approvalCitation?: string | undefined;
}

export type FundingResult =
  | { ok: true; fundingClass: FundingClass; approvalCitation: string | null }
  | { ok: false; code: string };

const WEAK_STATUSES = new Set(["derived_interpretation", "ai_hypothesis", "unverified_assumption"]);

export function classifyFunding(input: FundingInput): FundingResult {
  const requested = input.requested;
  if (input.typeKind !== "funding") {
    if (requested !== undefined && requested !== "none") {
      return { ok: false, code: "funding_class_not_allowed" };
    }
    return { ok: true, fundingClass: "none", approvalCitation: null };
  }
  if (requested === undefined || requested === "context" || requested === "none") {
    return { ok: true, fundingClass: "context", approvalCitation: null };
  }
  const citation = input.approvalCitation?.trim() ?? "";
  if (input.typeKey === "grant_funding_announcement") {
    return { ok: false, code: "grant_announcement_is_context_only" };
  }
  if (citation === "") return { ok: false, code: "approval_citation_required" };
  if (WEAK_STATUSES.has(input.evidenceStatus)) {
    return { ok: false, code: "approval_needs_stated_evidence" };
  }
  return { ok: true, fundingClass: "budget_approval_evidence", approvalCitation: citation };
}
