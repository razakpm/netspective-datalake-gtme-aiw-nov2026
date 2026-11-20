import { CLAIM_CLASSES, type ClaimClass, type RestrictedClaimClass } from "./types.js";

// The pure approval rule for claims (feature 005, research R-07). A restricted claim needs valid
// evidence and approvals from two different designated approvers, neither the drafter; any rejection
// stops a claim; a general claim needs valid evidence and one approval. Default is omission.

/** The claim's class is never lower than what the checker finds in its text. */
export function effectiveClass(
  declared: ClaimClass | null,
  found: readonly ClaimClass[],
): ClaimClass {
  if (declared !== null && declared !== "general") return declared;
  return CLAIM_CLASSES.find((c) => c !== "general" && found.includes(c)) ?? "general";
}

export interface EvidenceState {
  withdrawn: boolean;
  /** ISO-8601 UTC. Evidence is valid strictly before this instant. */
  expiresAt: string;
}

/** At least one item that is neither withdrawn nor expired. */
export function hasValidEvidence(evidence: readonly EvidenceState[], now: string): boolean {
  return evidence.some((e) => !e.withdrawn && Date.parse(e.expiresAt) > Date.parse(now));
}

export interface ReviewState {
  reviewerId: string;
  decision: "approve" | "reject";
}

export interface ApprovalInput {
  draftedBy: string;
  effectiveClass: ClaimClass;
  evidence: readonly EvidenceState[];
  priorReviews: readonly ReviewState[];
  reviewerId: string;
  decision: "approve" | "reject";
  now: string;
}

export type ApprovalResult =
  | {
      ok: true;
      status: "approved" | "in_review" | "rejected";
      approvals: number;
      needed: 1 | 2;
      pending: string[];
    }
  | { ok: false; codes: string[]; suggestion?: string };

export const isRestrictedClass = (c: ClaimClass): c is RestrictedClaimClass => c !== "general";

export function evaluateClaimApproval(input: ApprovalInput): ApprovalResult {
  const needed: 1 | 2 = isRestrictedClass(input.effectiveClass) ? 2 : 1;
  if (input.reviewerId === input.draftedBy) return { ok: false, codes: ["drafter_cannot_approve"] };
  if (input.priorReviews.some((r) => r.decision === "reject"))
    return { ok: false, codes: ["rejected"] };
  if (
    input.priorReviews.some(
      (r) => r.reviewerId === input.reviewerId && r.decision === input.decision,
    )
  ) {
    return { ok: false, codes: ["already_reviewed"] };
  }
  const prior = new Set(
    input.priorReviews.filter((r) => r.decision === "approve").map((r) => r.reviewerId),
  );
  if (input.decision === "reject") {
    return { ok: true, status: "rejected", approvals: prior.size, needed, pending: [] };
  }
  if (!hasValidEvidence(input.evidence, input.now)) {
    return {
      ok: false,
      codes: ["claim_needs_evidence"],
      suggestion: "Omit the statement until evidence is linked and still valid.",
    };
  }
  const approvals = prior.size + 1;
  return approvals >= needed
    ? { ok: true, status: "approved", approvals, needed, pending: [] }
    : { ok: true, status: "in_review", approvals, needed, pending: ["second_approver_required"] };
}
