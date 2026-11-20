import { call } from "./catalogue-http.js";

// Browser-side client for the offers API (contracts/offers.openapi.yaml). Every effort estimate and score
// is a hypothesis and is shown as one.

export type OfferStatus =
  "draft" | "internally_reviewed" | "approved" | "available" | "withdrawn" | "expired";

export interface CapacityStatus {
  offerId: string;
  state: "room" | "exhausted" | "no_limit_set";
  periodKind: "week" | "month";
  periodStart: string;
  periodEnd: string;
  limit: number | null;
  used: number;
  held: number;
  remaining: number | null;
  utilisation: number | null;
  offerStatus: OfferStatus;
}
export interface ClaimCover {
  status: "ok" | "lapsed";
  claimIds: string[];
  ruleIds: string[];
}
export interface OfferSummary {
  id: string;
  number: number;
  key: string;
  name: string | null;
  lockNo: number;
  status: OfferStatus;
  inForceVersionNo: number | null;
  latestVersionNo: number;
  latestStatus: OfferStatus;
  baselineIncomplete: boolean;
  acknowledgementStale: boolean;
  claimCover: ClaimCover;
  capacity: CapacityStatus;
}
export interface OfferSnapshot {
  name: string | null;
  format: string | null;
  targetIcp: string | null;
  buyerOutput: string | null;
  buyerEffort: string | null;
  effortEstimate: { text: string | null; status: "hypothesis" };
  conversionPath: string | null;
  landingPagePromise: string | null;
  cta: string | null;
  intakeFields: string[] | null;
  successHypotheses: string[] | null;
  sqlRuleRef: string | null;
  relatedCapabilityKeys: string[];
  paidTypeKey: string | null;
}
export interface OfferVersion {
  offerId: string;
  versionNo: number;
  snapshot: OfferSnapshot;
  placeholderAttributes: string[];
  status: OfferStatus;
  superseded: boolean;
  history: { status: OfferStatus; changedBy: string; note: string | null; changedAt: string }[];
  reason: string;
  createdBy: string;
  createdAt: string;
}
export interface Limitation {
  id: string;
  key: string;
  wording: string;
  active: boolean;
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  acknowledgementStale: boolean;
}
export interface OfferDetail extends OfferSummary {
  latest: OfferVersion;
  inForce: OfferVersion | null;
  limitations: Limitation[];
}
export interface Booking {
  id: string;
  offerId: string;
  externalRef: string | null;
  state: "booked" | "held" | "cancelled" | "no_show";
  sessionDate: string;
  periodStart: string;
  source: "manual" | "workshop";
}
export interface Scores {
  label: string;
  criteria: { key: string; label: string }[];
  scores: {
    offerId: string;
    criterionKey: string;
    score: number;
    status: "hypothesis";
    rationale: string | null;
  }[];
}

export interface OffersApi {
  list(): Promise<{ items: OfferSummary[] }>;
  get(id: string): Promise<OfferDetail>;
  versions(id: string): Promise<{ items: OfferVersion[] }>;
  moveStatus(
    id: string,
    versionNo: number,
    to: OfferStatus,
    note: string,
    key: string,
  ): Promise<OfferVersion>;
  acknowledge(id: string, limitationId: string, key: string): Promise<Limitation>;
  setCapacity(
    id: string,
    body: { periodKind: "week" | "month"; limitSessions: number; reason?: string },
    key: string,
  ): Promise<unknown>;
  bookings(id: string): Promise<{ items: Booking[] }>;
  recordBooking(
    id: string,
    body: { sessionDate: string; externalRef?: string },
    key: string,
  ): Promise<Booking>;
  updateBooking(
    id: string,
    bookingId: string,
    body: { state?: "held" | "cancelled" | "no_show"; sessionDate?: string },
    key: string,
  ): Promise<Booking>;
  scores(): Promise<Scores>;
}

const enc = encodeURIComponent;
export const browserOffersApi: OffersApi = {
  list: () => call("GET", "/offers"),
  get: (id) => call("GET", `/offers/${enc(id)}`),
  versions: (id) => call("GET", `/offers/${enc(id)}/versions`),
  moveStatus: (id, no, to, note, key) =>
    call("POST", `/offers/${enc(id)}/versions/${no}/status`, key, { to, note }),
  acknowledge: (id, limitationId, key) =>
    call("POST", `/offers/${enc(id)}/limitations/${enc(limitationId)}/acknowledge`, key),
  setCapacity: (id, body, key) => call("PUT", `/offers/${enc(id)}/capacity`, key, body),
  bookings: (id) => call("GET", `/offers/${enc(id)}/bookings`),
  recordBooking: (id, body, key) => call("POST", `/offers/${enc(id)}/bookings`, key, body),
  updateBooking: (id, bookingId, body, key) =>
    call("PATCH", `/offers/${enc(id)}/bookings/${enc(bookingId)}`, key, body),
  scores: () => call("GET", "/offer-scores"),
};

/** The next statuses the API will accept from a status (advisory: the server enforces the order). */
export const NEXT_STATUSES: Record<OfferStatus, OfferStatus[]> = {
  draft: ["internally_reviewed", "withdrawn"],
  internally_reviewed: ["approved", "withdrawn"],
  approved: ["available", "withdrawn", "expired"],
  available: ["withdrawn", "expired"],
  withdrawn: [],
  expired: [],
};
