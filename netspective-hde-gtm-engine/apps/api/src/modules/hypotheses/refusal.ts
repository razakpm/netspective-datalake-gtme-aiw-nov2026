import type { SqliteDatabase } from "@gtm/db";
import type { ActorType } from "@gtm/domain";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";

// Refusals of the hypotheses module are audited in their own transaction (so they survive the rollback of
// the refused change) with codes and rule ids only, then raised as problems (spec FR-038).
export interface HypothesisActor {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export class HypothesisRefusal extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly codes: string[],
    readonly ruleIds: string[] = [],
  ) {
    super(codes.join(", "));
  }
}

export function audited<T>(
  db: SqliteDatabase,
  actor: HypothesisActor,
  action: string,
  entityId: string | null,
  fn: () => T,
): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof HypothesisRefusal)) throw error;
    db.transaction((tx) =>
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action,
          entityType: "account_hypothesis",
          entityId,
          outcome: "denied",
          after: { codes: error.codes, rule_ids: error.ruleIds },
          correlationId: actor.correlationId,
        },
        actor.now,
      ),
    );
    throw new HttpError(
      error.status,
      error.title,
      error.ruleIds.length
        ? `Rejected by the PHI boundary guard (${error.ruleIds.join(", ")})`
        : `Refused: ${error.codes.join(", ")}`,
      error.ruleIds.length ? { ruleIds: error.ruleIds } : {},
    );
  }
}
