import { call } from "./catalogue-http.js";

// Browser-side client for the claims API (contracts/claims.openapi.yaml).

export type ClaimStatus =
  "draft" | "in_review" | "approved" | "rejected" | "withdrawn" | "needs_review";

export interface ClaimSummary {
  id: string;
  text: string;
  declaredClass: string | null;
  effectiveClass: string;
  status: ClaimStatus;
  restricted: boolean;
  approvalsNeeded: number;
  approvalsHave: number;
  draftedBy: string;
  draftedAt: string;
  versionNo: number;
}
export interface LintMatch {
  class: string;
  ruleId: string;
  start: number;
  end: number;
  text: string;
  covered: boolean;
}
export interface ClaimDetail extends ClaimSummary {
  evidence: {
    id: string;
    kind: string;
    reference: string;
    owner: string;
    expiresAt: string;
    withdrawnAt: string | null;
    valid: boolean;
  }[];
  reviews: {
    decision: "approve" | "reject";
    reviewerId: string;
    note: string;
    decidedAt: string;
  }[];
  lint: { listVersion: number; matches: LintMatch[] };
  suggestion?: string;
}

export interface ClaimsApi {
  list(status?: ClaimStatus): Promise<{ items: ClaimSummary[] }>;
  get(id: string): Promise<ClaimDetail>;
  review(
    id: string,
    decision: "approve" | "reject",
    note: string,
    key: string,
  ): Promise<ClaimDetail>;
  markFalsePositive(
    body: { sentence: string; ruleId: string; reason: string },
    key: string,
  ): Promise<{ id: string }>;
}

const enc = encodeURIComponent;
export const browserClaimsApi: ClaimsApi = {
  list: (status) => call("GET", `/claims${status ? `?status=${enc(status)}` : ""}`),
  get: (id) => call("GET", `/claims/${enc(id)}`),
  review: (id, decision, note, key) =>
    call("POST", `/claims/${enc(id)}/review`, key, { decision, note }),
  markFalsePositive: (body, key) => call("POST", "/claims/dispositions", key, body),
};
