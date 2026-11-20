import type { SqliteDatabase } from "@gtm/db";
import { guardValue, hasPermission, type ActorType, type Permission } from "@gtm/domain";
import { HttpError } from "../http/errors.js";
import { recordAudit } from "../modules/audit/index.js";

// Shared by the claims, offers and capabilities modules (feature 005): the acting caller, refusals that are
// audited in their own transaction with codes only, permission checks and the PHI guard on free text.
// Nothing here knows about claims, offers or capabilities.

export interface CatalogueActor {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  /** Permissions held through the caller's active roles (resolved by the route layer). */
  permissions: readonly Permission[];
  now?: (() => Date) | undefined;
}

export class CatalogueRefusal extends Error {
  constructor(
    readonly status: number,
    readonly title: string,
    readonly codes: string[],
    readonly ruleIds: string[] = [],
    readonly detail?: string,
  ) {
    super(codes.join(", "));
  }
}

/** Run `fn`; a refusal is audited (codes and rule ids only) in its own transaction, then raised as a problem. */
export function audited<T>(
  db: SqliteDatabase,
  actor: CatalogueActor,
  action: string,
  entityType: string,
  entityId: string | null,
  fn: () => T,
): T {
  try {
    return fn();
  } catch (error) {
    if (!(error instanceof CatalogueRefusal)) throw error;
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
    throw new HttpError(
      error.status,
      error.title,
      error.detail ??
        (error.ruleIds.length
          ? `Rejected by the PHI boundary guard (${error.ruleIds.join(", ")})`
          : `Refused: ${error.codes.join(", ")}`),
      { ...(error.ruleIds.length ? { ruleIds: error.ruleIds } : {}) },
    );
  }
}

/** 403 unless the actor holds the permission. AI and system actors never act through the catalogue. */
export function requirePermission(actor: CatalogueActor, permission: Permission): void {
  if (
    actor.actorType !== "human" ||
    !hasPermission([{ key: "actor", permissions: actor.permissions }], permission)
  ) {
    throw new CatalogueRefusal(403, "Not permitted", ["forbidden", permission]);
  }
}

/** Refuse whole when any free-text part matches the PHI guard; nothing is stored or echoed. */
export function guardFreeText(parts: Record<string, unknown>): void {
  const decision = guardValue(parts);
  if (decision.decision !== "allow") {
    throw new CatalogueRefusal(422, "Text refused", ["phi_guard"], decision.rule_ids);
  }
}

export const nowOf = (actor: CatalogueActor): Date => (actor.now ?? (() => new Date()))();
