import { call, newKey } from "./catalogue-http.js";

// Browser-side client for the offer recommendations and wait-list API (contracts/routing.openapi.yaml).
// A recommendation is advice for a person: accepting one sends nothing.

export type Outcome = "offer" | "research" | "no_action";
export type ReviewState = "pending" | "accepted" | "dismissed";

export interface Recommendation {
  id: string;
  accountId: string;
  contactId: string | null;
  trigger: "operator" | "offer5_download";
  requestId: string | null;
  ruleSetVersion: number;
  outcome: Outcome;
  offerId: string | null;
  offerKey: string | null;
  outreach: "allowed" | "blocked";
  blockedReasons: string[];
  eligible: { offerKey: string; reason: string }[];
  excluded: { offerKey: string; code: string }[];
  matched: { ruleId: string; priority: number; result: string }[];
  alternatives: {
    kind: "wait_list" | "offer" | "research" | "do_nothing";
    offerKey: string | null;
    offerId: string | null;
    reason: string;
  }[];
  ranking: string[] | null;
  aiUsed: boolean;
  aiFallback: boolean;
  explanation: string;
  limitations: string[];
  outOfDate: boolean;
  reviewState: ReviewState;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  createdAt: string;
}

export interface WaitlistEntry {
  id: string;
  offerId: string;
  accountId: string;
  contactId: string | null;
  reason: string;
  state: "waiting" | "released" | "removed";
  addedBy: string;
  addedAt: string;
}

export interface RecommendationsApi {
  list(accountId: string): Promise<{ items: Recommendation[] }>;
  create(accountId: string, contactId: string | undefined, key: string): Promise<Recommendation>;
  review(
    id: string,
    body: { decision: "accept" | "dismiss"; reason?: string },
    key: string,
  ): Promise<Recommendation>;
  addToWaitlist(
    offerId: string,
    body: { accountId: string; contactId?: string; reason: string },
    key: string,
  ): Promise<WaitlistEntry>;
}

export const browserRecommendationsApi: RecommendationsApi = {
  list: (accountId) =>
    call("GET", `/accounts/${encodeURIComponent(accountId)}/offer-recommendations`),
  create: (accountId, contactId, key) =>
    call(
      "POST",
      `/accounts/${encodeURIComponent(accountId)}/offer-recommendations`,
      key,
      contactId ? { contactId } : {},
    ),
  review: (id, body, key) =>
    call("POST", `/offer-recommendations/${encodeURIComponent(id)}/review`, key, body),
  addToWaitlist: (offerId, body, key) =>
    call("POST", `/offers/${encodeURIComponent(offerId)}/waitlist`, key, body),
};

export { newKey };

// ---- plain words ---------------------------------------------------------------------------------

const OFFER_NAMES: Record<string, string> = {
  "sender-onboarding-friction-map": "Offer 1, the Sender Onboarding Friction Map",
  "ccda-to-fhir-mapping-decision-register": "Offer 5, the CCDA-to-FHIR Mapping Decision Register",
  "pilot-input-trace-workshop": "Offer 6, the Pilot Input Trace Workshop",
};
export const offerLabel = (key: string | null): string =>
  key === null ? "no offer" : (OFFER_NAMES[key] ?? key.replace(/-/g, " "));

export const outcomeText = (r: Pick<Recommendation, "outcome" | "offerKey">): string =>
  r.outcome === "offer"
    ? `Recommended: ${offerLabel(r.offerKey)}`
    : r.outcome === "research"
      ? "Further research is recommended before any offer"
      : "No action is recommended";

const BLOCKED: Record<string, string> = {
  account_excluded: "the organisation is outside the ICP",
  fit_not_priority: "ICP fit is not strong enough yet",
  contact_suppressed: "the contact or account is suppressed",
  no_communication_permission: "there is no permission to contact them",
};
export const blockedText = (codes: readonly string[]): string =>
  codes.map((c) => BLOCKED[c] ?? c.replace(/_/g, " ")).join("; ");

const EXCLUDED: Record<string, string> = {
  offer_unavailable: "is not available",
  capacity_exhausted: "is full for this period",
};
export const exclusionText = (e: { offerKey: string; code: string }): string =>
  e.offerKey === "*"
    ? (BLOCKED[e.code] ?? e.code)
    : `${offerLabel(e.offerKey)} ${EXCLUDED[e.code] ?? e.code}`;
