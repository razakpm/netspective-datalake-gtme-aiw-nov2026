import type { SqliteDatabase, Tx } from "@gtm/db";
import {
  evaluateReview,
  guardValue,
  type ReviewDecision,
  type ReviewStatus,
  type Reliability,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { SignalRefusal, auditedRefusals, type SignalActor } from "./actor.js";
import { emitReviewed } from "./events.js";
import { getSignalDetail, type SignalDetail } from "./queries.js";
import { appendProvenance, getSignal, resolveAccountScope } from "./repository.js";

// Review workflow (tasks T038 to T042; spec FR-025 to FR-027, FR-024, FR-037). Decisions are appended,
// never edited; the observation never changes. Only a human reviewer may decide: the route checks
// `signals.review`, and an AI or system actor is refused here as well.

export interface ReviewInput {
  decision: ReviewDecision;
  reason?: string | undefined;
  contradictsSignalId?: string | undefined;
  /** Reviewer change of reliability, only with a reason (FR-010). */
  reliability?: Reliability | undefined;
}

const STATUS_FOR: Record<string, number> = {
  already_approved: 409,
  already_rejected: 409,
};

export class ReviewService {
  constructor(private readonly db: SqliteDatabase) {}

  review(actor: SignalActor, signalId: string, input: ReviewInput): SignalDetail {
    const now = actor.now ?? (() => new Date());
    return auditedRefusals(this.db, actor, "signal.review.refused", "signal", signalId, () => {
      if (actor.actorType !== "human") {
        throw new SignalRefusal(403, "Forbidden", ["reviewer_must_be_human"]);
      }
      const guard = guardValue({ reason: input.reason });
      if (guard.decision !== "allow") {
        throw new SignalRefusal(422, "Review refused", ["phi_guard"], guard.rule_ids);
      }
      return this.db.transaction((tx) => this.reviewInTx(tx, actor, signalId, input, now));
    });
  }

  private reviewInTx(
    tx: Tx,
    actor: SignalActor,
    signalId: string,
    input: ReviewInput,
    now: () => Date,
  ): SignalDetail {
    const signal = getSignal(tx, signalId);
    if (!signal) throw new SignalRefusal(404, "Not found", ["unknown_signal"]);
    const at = now().toISOString();

    const outcome = evaluateReview(
      {
        status: signal.review_status,
        newProvenanceFlag: signal.new_provenance_flag === 1,
        reverifyRequired: signal.reverify_required === 1,
      },
      {
        decision: input.decision,
        reason: input.reason,
        contradictsSignalId: input.contradictsSignalId,
        signalId,
      },
    );
    if (!outcome.ok) {
      throw new SignalRefusal(STATUS_FOR[outcome.code] ?? 400, "Review refused", [outcome.code]);
    }
    if (input.reliability !== undefined && (input.reason?.trim().length ?? 0) < 3) {
      throw new SignalRefusal(400, "Review refused", ["reason_required_for_reliability_change"]);
    }

    let other: ReturnType<typeof getSignal>;
    if (input.decision === "contradict") {
      other = getSignal(tx, input.contradictsSignalId!);
      if (!other) throw new SignalRefusal(404, "Not found", ["unknown_contradicted_signal"]);
      const a = resolveAccountScope(tx, signal.account_id)?.survivor;
      const b = resolveAccountScope(tx, other.account_id)?.survivor;
      if (a !== b)
        throw new SignalRefusal(422, "Review refused", ["contradiction_across_accounts"]);
    }

    tx.prepare(
      `INSERT INTO signal_review (id, signal_id, decision, reason, contradicts_signal_id, reliability_set,
         decided_by, decided_at) VALUES (?,?,?,?,?,?,?,?)`,
    ).run(
      uuidv7(),
      signalId,
      input.decision,
      input.reason?.trim() || null,
      input.contradictsSignalId ?? null,
      input.reliability ?? null,
      actor.userId!,
      at,
    );

    let nextStatus: ReviewStatus = outcome.nextStatus;
    const update = (id: string, set: string, ...args: (string | number | null)[]) =>
      tx.prepare(`UPDATE signal SET ${set}, updated_at = ? WHERE id = ?`).run(...args, at, id);

    switch (input.decision) {
      case "approve":
      case "reject":
        update(signalId, "review_status = ?", nextStatus);
        appendProvenance(tx, signalId, {
          kind: "reviewed",
          actorId: actor.userId,
          actorType: "human",
          method: "review",
          detail: { decision: input.decision },
          at,
        });
        break;
      case "contradict": {
        nextStatus = "contradictory";
        update(signalId, "review_status = 'contradictory'");
        update(other!.id, "review_status = 'contradictory'");
        const [a, b] = [signalId, other!.id].sort() as [string, string];
        tx.prepare(
          "INSERT OR IGNORE INTO signal_contradiction (id, signal_a, signal_b, created_by, created_at) VALUES (?,?,?,?,?)",
        ).run(uuidv7(), a, b, actor.userId!, at);
        const link = tx.prepare(
          `INSERT OR IGNORE INTO signal_link (id, signal_id, entity_type, entity_id, role, linked_by, linked_at)
           VALUES (?,?,?,?,?,?,?)`,
        );
        link.run(uuidv7(), signalId, "signal", other!.id, "contradictory", actor.userId, at);
        link.run(uuidv7(), other!.id, "signal", signalId, "contradictory", actor.userId, at);
        for (const id of [signalId, other!.id]) {
          appendProvenance(tx, id, {
            kind: "reviewed",
            actorId: actor.userId,
            actorType: "human",
            method: "review",
            detail: { decision: "contradict", with: id === signalId ? other!.id : signalId },
            at,
          });
        }
        break;
      }
      case "reverify":
        update(signalId, "reverify_required = 0");
        appendProvenance(tx, signalId, {
          kind: "reverified",
          actorId: actor.userId,
          actorType: "human",
          method: "review",
          detail: {},
          at,
        });
        break;
      case "clear_flag":
        update(signalId, "new_provenance_flag = 0");
        appendProvenance(tx, signalId, {
          kind: "flag_cleared",
          actorId: actor.userId,
          actorType: "human",
          method: "review",
          detail: {},
          at,
        });
        break;
    }
    if (input.reliability !== undefined) {
      update(
        signalId,
        "reliability = ?, reliability_overridden_by = ?",
        input.reliability,
        actor.userId,
      );
    }

    // A contradiction pair is resolved once neither signal is still contradictory.
    tx.prepare(
      `UPDATE signal_contradiction SET resolved_at = ?, resolved_by = ?
       WHERE resolved_at IS NULL AND (signal_a = ? OR signal_b = ?)
         AND NOT EXISTS (SELECT 1 FROM signal s WHERE s.id IN (signal_a, signal_b) AND s.review_status = 'contradictory')`,
    ).run(at, actor.userId!, signalId, signalId);

    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: "human",
        action: `signal.review.${input.decision}`,
        entityType: "signal",
        entityId: signalId,
        outcome: "success",
        before: { review_status: signal.review_status },
        after: { review_status: nextStatus },
        correlationId: actor.correlationId,
      },
      now,
    );
    emitReviewed(
      tx,
      { ...actor, actorId: actor.userId },
      {
        signalId,
        decision: input.decision,
        reviewStatus: nextStatus,
      },
    );
    return getSignalDetail(tx, signalId, now());
  }
}
