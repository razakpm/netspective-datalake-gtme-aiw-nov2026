// Browser-side client for the signals API (contracts/signals.openapi.yaml, sources.openapi.yaml) and
// plain-language error text. Reliability and confidence definitions are shown wherever the values appear.

export const RELIABILITY_DEFINITIONS = {
  high: "An official publication or a buyer's own statement.",
  medium: "A reputable third party or an analyst's direct observation.",
  low: "Unattributed, secondary or inferred.",
  unknown: "Not rated (never read as low or high).",
} as const;
export const CONFIDENCE_DEFINITIONS = {
  low: "Weak extraction: the source was ambiguous or the text was inferred.",
  medium: "Reasonable extraction: the source supports the observation with minor interpretation.",
  high: "Strong extraction: the source states the observation directly.",
} as const;

export type ReviewStatus = "pending" | "approved" | "rejected" | "contradictory";
export type Decision = "approve" | "reject" | "contradict" | "reverify" | "clear_flag";

export interface SignalSummary {
  id: string;
  accountId: string;
  typeKey: string;
  category: string;
  taxonomyVersion: number;
  observation: string;
  excerpt: string | null;
  excerptWithheldReason: "none" | "too_long" | "source_no_storage";
  source: { id: string; name: string; ref: string; unavailableSince: string | null };
  observedAt: string;
  publishedAt: string | null;
  reliability: keyof typeof RELIABILITY_DEFINITIONS;
  extractionConfidence: keyof typeof CONFIDENCE_DEFINITIONS;
  evidenceStatus: string;
  reviewStatus: ReviewStatus;
  isCurrent: boolean;
  stale: boolean;
  undated: boolean;
  freshUntil: string;
  flags: { newProvenanceSinceReview: boolean; reverifyRequired: boolean; contextOnly: boolean };
  fundingClass: string;
  regulatoryStatus: string | null;
  statusLabel: string;
}

export interface SignalDetail extends SignalSummary {
  provenance: { seq: number; kind: string; actorType: string; occurredAt: string }[];
  reviews: { decision: string; reason: string | null; decidedBy: string; decidedAt: string }[];
  contradictory: { entityType: string; entityId: string }[];
  externalUse: string;
}

export interface FeedFilters {
  type?: string;
  category?: string;
  icp?: string;
  accountId?: string;
  sourceId?: string;
  capability?: string;
  offer?: string;
  confidence?: string;
  freshness?: "fresh" | "stale" | "undated";
  reviewStatus?: ReviewStatus;
}

export interface SignalsApi {
  list(filters: FeedFilters): Promise<{ items: SignalSummary[]; nextCursor: string | null }>;
  detail(id: string): Promise<SignalDetail>;
  review(
    id: string,
    body: { decision: Decision; reason?: string; contradictsSignalId?: string },
    key: string,
  ): Promise<SignalDetail>;
  accountSignals(
    accountId: string,
    opts?: { currentOnly?: boolean },
  ): Promise<{ items: SignalSummary[]; nextCursor: string | null }>;
  types(): Promise<{ version: number; items: { key: string; category: string; label: string }[] }>;
  sources(): Promise<{ items: { id: string; name: string }[] }>;
  record(
    body: Record<string, unknown>,
    key: string,
  ): Promise<{ outcome: string; signal: SignalSummary }>;
}

export class SignalsApiError extends Error {
  constructor(readonly status: number) {
    super(`request failed (${status})`);
    this.name = "SignalsApiError";
  }
}

/** A message safe to show a person: never the server's detail, a stack or a raw error. */
export function describeSignalsError(error: unknown): string {
  if (error instanceof SignalsApiError) {
    if (error.status === 403) return "You do not have permission to do that.";
    if (error.status === 404) return "That signal no longer exists.";
    if (error.status === 409)
      return "That change conflicts with the current state. Refresh and try again.";
    if (error.status === 400 || error.status === 422)
      return "Please check the details and try again.";
  }
  return "Something went wrong. Please try again.";
}

const newKey = () => globalThis.crypto.randomUUID();
export { newKey as newSignalKey };

async function call<T>(method: string, path: string, key?: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw new SignalsApiError(response.status);
  return (await response.json()) as T;
}

const qs = (params: Record<string, string | boolean | undefined>) => {
  const q = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return q ? `?${q}` : "";
};

export const browserSignalsApi: SignalsApi = {
  list: (f) => call("GET", `/signals${qs({ ...f })}`),
  detail: (id) => call("GET", `/signals/${encodeURIComponent(id)}`),
  review: (id, body, key) => call("POST", `/signals/${encodeURIComponent(id)}/review`, key, body),
  accountSignals: (accountId, opts) =>
    call(
      "GET",
      `/accounts/${encodeURIComponent(accountId)}/signals${qs({ currentOnly: opts?.currentOnly })}`,
    ),
  types: () => call("GET", "/signal-types"),
  sources: () => call("GET", "/signal-sources"),
  record: (body, key) => call("POST", "/signals", key, body),
};
