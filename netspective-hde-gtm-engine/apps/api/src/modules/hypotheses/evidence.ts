import type { Tx } from "@gtm/db";
import {
  isCurrentEvidence,
  lastCurrentAt,
  type FlagState,
  type SupportingEvidenceState,
} from "@gtm/domain";
import type { HypothesisRow } from "./repository.js";

// Live evidence state of a hypothesis's supporting signals (research R-12): when each last counted as
// current evidence under feature 003's rule, and which changed state after the last review.

interface SignalFacts {
  id: string;
  review_status: "pending" | "approved" | "rejected" | "contradictory";
  fresh_until: string;
  purged_at: string | null;
  retain_until: string;
}

export interface EvidenceView {
  states: SupportingEvidenceState[];
  events: { state: FlagState; eventAt: string }[];
  lastCurrentAt: string | null;
}

export function evidenceView(tx: Tx, hypothesisId: string, now: Date): EvidenceView {
  const links = tx
    .prepare(
      "SELECT signal_id FROM hypothesis_evidence WHERE hypothesis_id = ? AND role = 'supporting'",
    )
    .all(hypothesisId) as { signal_id: string }[];
  const states: SupportingEvidenceState[] = [];
  const events: { state: FlagState; eventAt: string }[] = [];
  for (const l of links) {
    const s = tx
      .prepare(
        "SELECT id, review_status, fresh_until, purged_at, retain_until FROM signal WHERE id = ?",
      )
      .get(l.signal_id) as SignalFacts | undefined;
    if (!s) continue;
    const reviews = tx
      .prepare(
        "SELECT decision, decided_at FROM signal_review WHERE signal_id = ? ORDER BY decided_at, rowid",
      )
      .all(l.signal_id) as { decision: string; decided_at: string }[];
    const approves = reviews.filter((r) => r.decision === "approve");
    const lastApprove = approves.at(-1);
    const expired = s.purged_at !== null || s.retain_until <= now.toISOString();
    const currentNow = isCurrentEvidence(
      { reviewStatus: s.review_status, freshUntil: s.fresh_until, purged: expired },
      now,
    );
    let endedAt: string | null = null;
    if (lastApprove && !currentNow && s.fresh_until > lastApprove.decided_at) {
      const after = reviews.find(
        (r) =>
          r.decided_at >= lastApprove.decided_at &&
          (r.decision === "reject" || r.decision === "contradict") &&
          r !== lastApprove,
      );
      const candidates = [
        after?.decided_at,
        s.fresh_until <= now.toISOString() ? s.fresh_until : undefined,
        s.purged_at ?? undefined,
      ].filter((x): x is string => Boolean(x));
      endedAt = candidates.length ? candidates.sort()[0]! : null;
    }
    states.push({ currentNow, currentEndedAt: endedAt });
    if (s.review_status === "rejected") {
      events.push({
        state: "rejected",
        eventAt:
          reviews.filter((r) => r.decision === "reject").at(-1)?.decided_at ?? now.toISOString(),
      });
    } else if (s.review_status === "contradictory") {
      events.push({
        state: "contradicted",
        eventAt:
          reviews.filter((r) => r.decision === "contradict").at(-1)?.decided_at ??
          now.toISOString(),
      });
    } else if (
      s.review_status === "approved" &&
      lastApprove &&
      s.fresh_until <= now.toISOString() &&
      s.fresh_until > lastApprove.decided_at
    ) {
      events.push({ state: "stale", eventAt: s.fresh_until });
    }
  }
  return { states, events, lastCurrentAt: lastCurrentAt(states, now) };
}

/** True when a supporting signal is `buyer_confirmed`, approved and not purged (mirrors the database trigger). */
export function hasValidatingEvidence(tx: Tx, hypothesisId: string): boolean {
  const row = tx
    .prepare(
      `SELECT 1 FROM hypothesis_evidence e JOIN signal s ON s.id = e.signal_id
       WHERE e.hypothesis_id = ? AND e.role = 'supporting' AND s.evidence_status = 'buyer_confirmed'
         AND s.review_status = 'approved' AND s.purged_at IS NULL LIMIT 1`,
    )
    .get(hypothesisId);
  return row !== undefined;
}

export function anchorFor(h: HypothesisRow, view: EvidenceView): string {
  const times = [view.lastCurrentAt, h.accepted_at ?? h.created_at, h.last_revived_at].filter(
    (x): x is string => x !== null,
  );
  return times.sort().at(-1)!;
}
