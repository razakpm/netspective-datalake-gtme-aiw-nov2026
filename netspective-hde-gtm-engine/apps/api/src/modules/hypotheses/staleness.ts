import type { SqliteDatabase } from "@gtm/db";
import { flagReason, isStaleDue } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { emitUpdated } from "./events.js";
import { anchorFor, evidenceView } from "./evidence.js";
import type { HypothesisActor } from "./refusal.js";
import type { HypothesisRow } from "./repository.js";

// The staleness rule and flag materialisation (task T047; spec FR-029, FR-030). Reads compute `effectiveStatus`
// and the flag live, so correctness never depends on this job; the job writes the system decision for stale
// and the stored flag so lists can filter on them. Idempotent.

export class HypothesisStaleness {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly staleDays = 90,
  ) {}

  apply(actor: HypothesisActor): { staled: number; flagged: number } {
    const now = actor.now ?? (() => new Date());
    return this.db.transaction((tx) => {
      const rows = tx
        .prepare("SELECT * FROM account_hypothesis WHERE acceptance = 'accepted'")
        .all() as unknown as HypothesisRow[];
      let staled = 0;
      let flagged = 0;
      const at = now().toISOString();
      for (const h of rows) {
        if (!h.status) continue;
        const ev = evidenceView(tx, h.id, now());
        if (
          isStaleDue({
            status: h.status,
            anchor: anchorFor(h, ev),
            now: now(),
            staleDays: this.staleDays,
          })
        ) {
          tx.prepare(
            `INSERT INTO hypothesis_status_decision (id, hypothesis_id, from_status, to_status, note, decided_by, decided_by_type, reason_code, decided_at)
             VALUES (?,?,?,'stale',?,NULL,'system','no_current_evidence',?)`,
          ).run(
            uuidv7(),
            h.id,
            h.status,
            `No supporting signal has been current evidence for ${this.staleDays} days.`,
            at,
          );
          tx.prepare(
            "UPDATE account_hypothesis SET status = 'stale', updated_at = ? WHERE id = ?",
          ).run(at, h.id);
          recordAudit(
            tx,
            {
              actorId: null,
              actorType: "system",
              action: "hypothesis.stale",
              entityType: "account_hypothesis",
              entityId: h.id,
              outcome: "success",
              before: { status: h.status },
              after: { status: "stale" },
              correlationId: actor.correlationId,
            },
            now,
          );
          emitUpdated(
            tx,
            { actorId: null, actorType: "system", correlationId: actor.correlationId, now },
            { hypothesisId: h.id, accountId: h.account_id, change: "stale", status: "stale" },
          );
          staled += 1;
          continue;
        }
        if (h.status === "stale") continue; // already stale: the stale status says it
        const reason = flagReason(ev.events, h.last_reviewed_at ?? h.accepted_at ?? h.created_at);
        const stored = h.flagged_for_review === 1 ? h.flag_reason : null;
        if (reason !== stored) {
          tx.prepare(
            "UPDATE account_hypothesis SET flagged_for_review = ?, flag_reason = ?, updated_at = ? WHERE id = ?",
          ).run(reason ? 1 : 0, reason, at, h.id);
          if (reason) {
            emitUpdated(
              tx,
              { actorId: null, actorType: "system", correlationId: actor.correlationId, now },
              { hypothesisId: h.id, accountId: h.account_id, change: "flag", status: h.status },
            );
            flagged += 1;
          }
        }
      }
      return { staled, flagged };
    });
  }
}
