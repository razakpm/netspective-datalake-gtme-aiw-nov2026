import type { SqliteDatabase } from "@gtm/db";
import { hasValidEvidence, type ActorType } from "@gtm/domain";
import { recordAudit } from "../audit/index.js";
import { emitClaimNeedsReview } from "./events.js";
import { listClaims, listEvidence } from "./repository.js";

// The optional daily job (feature 005, task T058). Reads compute `needs_review` live, so nothing depends on
// this job; it only announces, once per lapse, that an approved claim has lost its evidence. Idempotent: the
// event key is the claim and the instant the last evidence stopped being valid.

export interface StalenessActor {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export class ClaimStaleness {
  constructor(private readonly db: SqliteDatabase) {}

  apply(actor: StalenessActor): { flagged: number } {
    const now = (actor.now ?? (() => new Date()))();
    const at = now.toISOString();
    return this.db.transaction((tx) => {
      let flagged = 0;
      for (const claim of listClaims(tx, { status: "approved" })) {
        const evidence = listEvidence(tx, claim.id);
        if (
          hasValidEvidence(
            evidence.map((e) => ({ withdrawn: e.withdrawnAt !== null, expiresAt: e.expiresAt })),
            at,
          )
        ) {
          continue;
        }
        const lapsedAt =
          evidence
            .map((e) => e.withdrawnAt ?? e.expiresAt)
            .sort()
            .pop() ?? claim.draftedAt;
        const key = `claim-needs-review:${claim.id}:${lapsedAt}`;
        const seen = tx.prepare("SELECT 1 FROM outbox_event WHERE idempotency_key = ?").get(key);
        if (seen) continue;
        emitClaimNeedsReview(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            correlationId: actor.correlationId,
            now: actor.now,
          },
          { claimId: claim.id, idempotencyKey: key },
        );
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "claim.needs_review",
            entityType: "claim",
            entityId: claim.id,
            outcome: "success",
            correlationId: actor.correlationId,
          },
          actor.now,
        );
        flagged++;
      }
      return { flagged };
    });
  }
}
