import type { SqliteDatabase } from "@gtm/db";
import type { ActorType } from "@gtm/domain";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";

// Actor and refusal plumbing shared by the signals services. A refusal is audited in its own transaction
// (so it survives the rollback of the refused change) and carries codes and rule ids only, never content
// (spec FR-016, FR-040).

export interface SignalActor {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
  /** True only for a reviewer (signals.review): a person who may override a signal's reliability. */
  canOverrideReliability?: boolean | undefined;
}

export class SignalRefusal extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly codes: string[],
    readonly ruleIds: string[] = [],
  ) {
    super(codes.join(", "));
  }
}

export function toHttpError(r: SignalRefusal): HttpError {
  const detail = r.ruleIds.length
    ? `Rejected by the PHI boundary guard (${r.ruleIds.join(", ")})`
    : `Refused: ${r.codes.join(", ")}`;
  return new HttpError(r.status, r.title, detail, r.ruleIds.length ? { ruleIds: r.ruleIds } : {});
}

/** Run `fn`; if it refuses, audit the refusal (codes only) and raise the HTTP problem. */
export function auditedRefusals<T>(
  db: SqliteDatabase,
  actor: SignalActor,
  action: string,
  entityType: string,
  entityId: string | null,
  fn: () => T,
): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof SignalRefusal)) throw error;
    db.transaction((tx) =>
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: actor.actorType,
          action,
          entityType,
          entityId,
          outcome: "denied",
          after: { codes: error.codes, rule_ids: error.ruleIds },
          correlationId: actor.correlationId,
        },
        actor.now,
      ),
    );
    throw toHttpError(error);
  }
}
