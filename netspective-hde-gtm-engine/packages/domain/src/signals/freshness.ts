import type { SignalKind } from "./taxonomy.js";

// Freshness and current evidence (spec FR-031 to FR-034; research R-06). Pure and deterministic: the
// same inputs and the same `now` always give the same answer.

const DAY_MS = 86_400_000;

export interface FreshnessDates {
  publishedAt: string | null;
  collectedAt: string;
  observedAt: string;
  kind: SignalKind;
}

/** Published date, else collected date (observed date for first-party types). */
export function freshAnchor(d: FreshnessDates): string {
  if (d.publishedAt) return d.publishedAt;
  return d.kind === "first_party" ? d.observedAt : d.collectedAt;
}

/** A source with no published date is undated, except first-party types whose date is the event itself. */
export function isUndated(d: Pick<FreshnessDates, "publishedAt" | "kind">): boolean {
  return d.publishedAt === null && d.kind !== "first_party";
}

export function freshUntil(anchorIso: string, windowDays: number): string {
  return new Date(Date.parse(anchorIso) + windowDays * DAY_MS).toISOString();
}

/** Stale from the moment `now` reaches `fresh_until`. */
export function isStale(freshUntilIso: string, now: Date): boolean {
  return now.getTime() >= Date.parse(freshUntilIso);
}

export interface CurrentEvidenceInput {
  reviewStatus: "pending" | "approved" | "rejected" | "contradictory";
  freshUntil: string;
  purged: boolean;
}

/** Approved, within its window, not purged. Rejected, contradictory and pending never count (FR-029, FR-033). */
export function isCurrentEvidence(s: CurrentEvidenceInput, now: Date): boolean {
  return s.reviewStatus === "approved" && !s.purged && !isStale(s.freshUntil, now);
}
