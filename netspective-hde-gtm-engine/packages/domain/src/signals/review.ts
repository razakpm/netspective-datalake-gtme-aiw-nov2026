// Review transition rules (spec FR-025 to FR-027, FR-024, FR-037; data-model state transitions). Pure.
// Reviewer permission is checked by the service; this file decides only whether a decision is valid.

export const REVIEW_DECISIONS = [
  "approve",
  "reject",
  "contradict",
  "reverify",
  "clear_flag",
] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type ReviewStatus = "pending" | "approved" | "rejected" | "contradictory";

export interface ReviewContext {
  status: ReviewStatus;
  newProvenanceFlag: boolean;
  reverifyRequired: boolean;
}

export interface ReviewInput {
  decision: ReviewDecision;
  reason?: string | undefined;
  contradictsSignalId?: string | undefined;
  signalId: string;
}

export type ReviewOutcome = { ok: true; nextStatus: ReviewStatus } | { ok: false; code: string };

const MIN_REASON = 3;

export function evaluateReview(ctx: ReviewContext, input: ReviewInput): ReviewOutcome {
  const reason = input.reason?.trim() ?? "";
  switch (input.decision) {
    case "approve":
      if (ctx.status === "approved") return { ok: false, code: "already_approved" };
      return { ok: true, nextStatus: "approved" };
    case "reject":
      if (reason.length < MIN_REASON) return { ok: false, code: "reason_required" };
      if (ctx.status === "rejected") return { ok: false, code: "already_rejected" };
      return { ok: true, nextStatus: "rejected" };
    case "contradict":
      if (!input.contradictsSignalId) return { ok: false, code: "contradicted_signal_required" };
      if (input.contradictsSignalId === input.signalId) {
        return { ok: false, code: "cannot_contradict_itself" };
      }
      return { ok: true, nextStatus: "contradictory" };
    case "reverify":
      if (reason === "") return { ok: false, code: "reason_required" };
      if (!ctx.reverifyRequired) return { ok: false, code: "nothing_to_reverify" };
      return { ok: true, nextStatus: ctx.status };
    case "clear_flag":
      if (!ctx.newProvenanceFlag) return { ok: false, code: "no_flag_to_clear" };
      return { ok: true, nextStatus: ctx.status };
  }
}
