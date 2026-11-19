import { call } from "./research-api.js";

// Browser-side client for the hypotheses API (contracts/hypotheses.openapi.yaml).

export type HypothesisStatus =
  "untested" | "strengthening" | "weakening" | "validated" | "rejected" | "stale";

export interface SignalRef {
  signalId: string;
  observation: string;
  evidenceStatus: string;
  reviewStatus: string;
  isCurrent: boolean;
  source?: { name: string; ref: string };
}

export interface HypothesisSummary {
  id: string;
  accountId: string;
  acceptance: "proposed" | "accepted" | "dismissed";
  origin: "analyst" | "ai";
  statement: string;
  category: string;
  status: HypothesisStatus | null;
  effectiveStatus: HypothesisStatus | null;
  confidence: { band: "low" | "medium" | "high"; explanation: string };
  flaggedForReview: boolean;
  flagReason: string | null;
  notForPrioritisation: boolean;
  label: string;
}

export interface Hypothesis extends HypothesisSummary {
  supporting: SignalRef[];
  contradictory: SignalRef[];
  buyerConfirmedFacts: SignalRef[];
  assumptions: { text: string; source: string; interpretationId: string | null }[];
  relevance: { icp: string[]; capability: string[]; offer: string[] };
  statusHistory: {
    fromStatus: string | null;
    toStatus: string;
    note: string;
    decidedBy: string | null;
    decidedByType: string;
    decidedAt: string;
  }[];
  definitions: Record<"low" | "medium" | "high", string>;
}

export const hypothesesApi = {
  list: (accountId: string, acceptance: "accepted" | "proposed") =>
    call<{ items: HypothesisSummary[] }>(
      "GET",
      `/accounts/${encodeURIComponent(accountId)}/hypotheses?acceptance=${acceptance}`,
    ),
  get: (id: string) => call<Hypothesis>("GET", `/hypotheses/${encodeURIComponent(id)}`),
  accept: (id: string, key: string) =>
    call<Hypothesis>("POST", `/hypotheses/${encodeURIComponent(id)}/accept`, key),
  dismiss: (id: string, key: string) =>
    call<Hypothesis>("POST", `/hypotheses/${encodeURIComponent(id)}/dismiss`, key),
  changeStatus: (id: string, status: HypothesisStatus, note: string, key: string) =>
    call<Hypothesis>("PATCH", `/hypotheses/${encodeURIComponent(id)}`, key, { status, note }),
  addAssumption: (id: string, text: string, key: string) =>
    call<Hypothesis>("POST", `/hypotheses/${encodeURIComponent(id)}/assumptions`, key, { text }),
};

export type HypothesesApi = typeof hypothesesApi;

const FLAG_TEXT: Record<string, string> = {
  supporting_signal_rejected: "A supporting signal was rejected after the last review.",
  supporting_signal_stale: "A supporting signal has gone stale since the last review.",
  supporting_signal_contradicted:
    "A supporting signal was marked contradictory after the last review.",
};
export const describeFlag = (reason: string | null): string =>
  reason ? (FLAG_TEXT[reason] ?? "A supporting signal changed after the last review.") : "";

const STATUS_REASONS: Record<string, string> = {
  validated_needs_buyer_confirmed_evidence:
    "Validated needs a supporting signal that is approved and buyer-confirmed.",
  transition_not_allowed: "That status change is not allowed from the current status.",
  note_required: "A note is required.",
  reviewer_must_be_human: "Only a person can change a status.",
};
export const describeStatusRefusal = (codes: string[]): string =>
  codes.map((c) => STATUS_REASONS[c]).find(Boolean) ??
  "That change was not accepted. Please check the details.";
