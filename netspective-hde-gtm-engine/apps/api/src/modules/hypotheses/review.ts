import type { SqliteDatabase } from "@gtm/db";
import { evaluateStatusChange, flagReason, guardValue, type HypothesisStatus } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { emitUpdated } from "./events.js";
import { evidenceView, hasValidatingEvidence } from "./evidence.js";
import { audited, HypothesisRefusal, type HypothesisActor } from "./refusal.js";
import { getHypothesis } from "./repository.js";

// Reviewer-only status changes (tasks T046; spec FR-027 to FR-032). A reviewer, a note and an allowed
// transition are required; validated needs a supporting approved buyer-confirmed signal (also enforced by a
// database trigger). Decisions are appended; earlier ones stay in history.

const STATUS_FOR: Record<string, number> = {
  reviewer_must_be_human: 403,
  note_required: 422,
  transition_not_allowed: 409,
  validated_needs_buyer_confirmed_evidence: 422,
};

export class HypothesisReview {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly staleDays = 90,
  ) {}

  changeStatus(actor: HypothesisActor, id: string, to: HypothesisStatus, note: string): void {
    const now = actor.now ?? (() => new Date());
    audited(this.db, actor, "hypothesis.status.refused", id, () => {
      if (actor.actorType !== "human" || !actor.userId)
        throw new HypothesisRefusal(403, "Forbidden", ["reviewer_must_be_human"]);
      const guard = guardValue({ note });
      if (guard.decision !== "allow")
        throw new HypothesisRefusal(422, "Status change refused", ["phi_guard"], guard.rule_ids);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h) throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        if (h.acceptance !== "accepted" || !h.status)
          throw new HypothesisRefusal(409, "Conflict", ["not_accepted"]);
        const outcome = evaluateStatusChange({
          from: h.status,
          to,
          note,
          actor: { kind: "human" },
          hasValidatingEvidence: hasValidatingEvidence(tx, id),
        });
        if (!outcome.ok)
          throw new HypothesisRefusal(STATUS_FOR[outcome.code] ?? 422, "Status change refused", [
            outcome.code,
          ]);
        const at = now().toISOString();
        tx.prepare(
          `INSERT INTO hypothesis_status_decision (id, hypothesis_id, from_status, to_status, note, decided_by, decided_by_type, decided_at)
           VALUES (?,?,?,?,?,?, 'human', ?)`,
        ).run(uuidv7(), id, h.status, to, note.trim(), actor.userId, at);
        tx.prepare(
          `UPDATE account_hypothesis SET status = ?, last_reviewed_at = ?, flagged_for_review = 0, flag_reason = NULL,
             last_revived_at = CASE WHEN ? = 'stale' THEN ? ELSE last_revived_at END, updated_at = ? WHERE id = ?`,
        ).run(to, at, h.status, at, at, id);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: `hypothesis.status.${to}`,
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            before: { status: h.status },
            after: { status: to },
            correlationId: actor.correlationId,
          },
          now,
        );
        emitUpdated(
          tx,
          { ...actor, actorId: actor.userId, now },
          { hypothesisId: id, accountId: h.account_id, change: "status", status: to },
        );
      });
    });
  }

  /** A reviewer confirms they looked at a flagged hypothesis; the flag clears until a signal changes again. */
  acknowledgeFlag(actor: HypothesisActor, id: string, note: string): void {
    const now = actor.now ?? (() => new Date());
    audited(this.db, actor, "hypothesis.flag.refused", id, () => {
      if (actor.actorType !== "human" || !actor.userId)
        throw new HypothesisRefusal(403, "Forbidden", ["reviewer_must_be_human"]);
      if (note.trim().length < 3) throw new HypothesisRefusal(422, "Refused", ["note_required"]);
      const guard = guardValue({ note });
      if (guard.decision !== "allow")
        throw new HypothesisRefusal(422, "Refused", ["phi_guard"], guard.rule_ids);
      this.db.transaction((tx) => {
        const h = getHypothesis(tx, id);
        if (!h || h.acceptance !== "accepted" || !h.status)
          throw new HypothesisRefusal(404, "Not found", ["unknown_hypothesis"]);
        const reason = flagReason(
          evidenceView(tx, id, now()).events,
          h.last_reviewed_at ?? h.accepted_at ?? h.created_at,
        );
        if (!reason) throw new HypothesisRefusal(409, "Conflict", ["no_flag_to_acknowledge"]);
        const at = now().toISOString();
        tx.prepare(
          "UPDATE account_hypothesis SET last_reviewed_at = ?, flagged_for_review = 0, flag_reason = NULL, updated_at = ? WHERE id = ?",
        ).run(at, at, id);
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "hypothesis.flag.acknowledge",
            entityType: "account_hypothesis",
            entityId: id,
            outcome: "success",
            after: { reason },
            correlationId: actor.correlationId,
          },
          now,
        );
        emitUpdated(
          tx,
          { ...actor, actorId: actor.userId, now },
          { hypothesisId: id, accountId: h.account_id, change: "flag", status: h.status },
        );
      });
    });
  }
}
