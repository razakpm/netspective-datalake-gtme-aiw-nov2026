import type { HypothesisStatus } from "./status.js";

// The staleness rule and the review flag (feature 004, spec FR-030, research R-12). Deterministic: no model,
// and the same inputs and the same `now` always give the same answer.

const DAY = 86_400_000;

export interface SupportingEvidenceState {
  /** Counts as current evidence right now (feature 003: approved, within its window, not purged). */
  currentNow: boolean;
  /** The instant it stopped counting (window end, rejection, contradiction or purge); null if it never counted. */
  currentEndedAt: string | null;
}

/** The latest instant any supporting signal counted as current evidence ("now" if one still does). */
export function lastCurrentAt(
  evidence: readonly SupportingEvidenceState[],
  now: Date,
): string | null {
  let best: string | null = null;
  for (const e of evidence) {
    const at = e.currentNow ? now.toISOString() : e.currentEndedAt;
    if (at !== null && (best === null || at > best)) best = at;
  }
  return best;
}

export function stalenessAnchor(input: {
  lastCurrentAt: string | null;
  acceptedAt: string;
  lastRevivedAt: string | null;
}): string {
  return [input.lastCurrentAt, input.acceptedAt, input.lastRevivedAt]
    .filter((x): x is string => x !== null)
    .sort()
    .at(-1)!;
}

/** Stale when `now − anchor` reaches the window, for open statuses only (validated and rejected are flagged, not changed). */
export function isStaleDue(input: {
  status: HypothesisStatus;
  anchor: string;
  now: Date;
  staleDays: number;
}): boolean {
  if (
    input.status !== "untested" &&
    input.status !== "strengthening" &&
    input.status !== "weakening"
  )
    return false;
  return input.now.getTime() - Date.parse(input.anchor) >= input.staleDays * DAY;
}

export type FlagState = "rejected" | "contradicted" | "stale";
const FLAG_ORDER: readonly FlagState[] = ["rejected", "contradicted", "stale"];

/** The review-flag reason when a supporting signal changed state after the last review, else null. */
export function flagReason(
  signals: readonly { state: FlagState; eventAt: string }[],
  lastReviewedAt: string,
):
  | "supporting_signal_rejected"
  | "supporting_signal_contradicted"
  | "supporting_signal_stale"
  | null {
  for (const state of FLAG_ORDER) {
    if (signals.some((s) => s.state === state && s.eventAt > lastReviewedAt)) {
      return `supporting_signal_${state}` as never;
    }
  }
  return null;
}
