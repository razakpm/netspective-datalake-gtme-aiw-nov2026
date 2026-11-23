import { call } from "./catalogue-http.js";

// Browser-side client for the request inbox and notice versions (contracts/engagement.openapi.yaml).
// Nothing here sends a message.

export type RequestKind = "download" | "working_session" | "intake";
export type RequestState = "received" | "reviewed" | "linked" | "closed";
export type RequestFlag = "personal_email" | "org_type_differs" | "suppressed" | "no_consent";

export interface RequestSummary {
  id: string;
  kind: RequestKind;
  offerId: string;
  state: RequestState;
  email: string | null;
  displayName: string | null;
  orgName: string | null;
  accountId: string | null;
  contactId: string | null;
  flags: RequestFlag[];
  submittedAt: string;
}
export interface RequestDetail extends RequestSummary {
  roleTitle: string | null;
  orgType: string | null;
  consent: { noticeVersionId: string; consentGiven: boolean; recordedAt: string };
  download: {
    delivered: boolean;
    deliveryFailure: string | null;
    linkExpiresAt: string | null;
  } | null;
  decisions: string[] | null;
  intake: Record<string, unknown> | null;
  recommendationId: string | null;
}
export interface NoticeVersion {
  id: string;
  version: number;
  noticeText: string;
  consentText: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
}

export interface ReviewBody {
  action: "mark_reviewed" | "link" | "close";
  accountId?: string;
  businessEmail?: string;
  reason?: string;
}

export interface RequestsApi {
  list(filter: {
    state?: string;
    kind?: string;
    flag?: string;
  }): Promise<{ items: RequestSummary[] }>;
  get(id: string): Promise<RequestDetail>;
  review(id: string, body: ReviewBody, key: string): Promise<RequestDetail>;
  notices: {
    list(): Promise<{ items: NoticeVersion[] }>;
    create(body: { noticeText: string; consentText: string }, key: string): Promise<NoticeVersion>;
    approve(id: string, key: string): Promise<NoticeVersion>;
  };
}

const query = (filter: Record<string, string | undefined>) => {
  const q = Object.entries(filter)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v as string)}`)
    .join("&");
  return q ? `?${q}` : "";
};

export const browserRequestsApi: RequestsApi = {
  list: (filter) => call("GET", `/offer-requests${query(filter)}`),
  get: (id) => call("GET", `/offer-requests/${encodeURIComponent(id)}`),
  review: (id, body, key) =>
    call("POST", `/offer-requests/${encodeURIComponent(id)}/review`, key, body),
  notices: {
    list: () => call("GET", "/notice-versions"),
    create: (body, key) => call("POST", "/notice-versions", key, body),
    approve: (id, key) =>
      call("POST", `/notice-versions/${encodeURIComponent(id)}/approve`, key, {}),
  },
};

export const FLAG_TEXT: Record<RequestFlag, string> = {
  personal_email: "Personal email",
  org_type_differs: "Organisation type differs",
  suppressed: "Suppressed",
  no_consent: "No consent to be contacted",
};
export const KIND_TEXT: Record<RequestKind, string> = {
  download: "Register download",
  working_session: "Working session request",
  intake: "Intake",
};
