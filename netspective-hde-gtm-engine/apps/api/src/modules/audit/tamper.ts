import type { SqliteDatabase, Tx } from "@gtm/db";
import { recordAudit } from "./writer.js";

// Tamper-attempt handler (task T060). Application code paths never modify audit rows; if one tries, the
// database refuses, this handler rolls the attempt back and records a SEPARATE audit event in a new
// transaction. The event names the kind of attempt only, never the attempted content.

export class AuditTamperError extends Error {
  constructor(readonly kind: "update" | "delete") {
    super(`audit events are append-only; ${kind} refused`);
    this.name = "AuditTamperError";
  }
}

export interface TamperContext {
  kind: "update" | "delete";
  actorId: string | null;
  correlationId: string | null;
}

export function runAuditMutation(
  db: SqliteDatabase,
  context: TamperContext,
  execute: (tx: Tx) => void,
): void {
  try {
    db.transaction(execute); // rolls back on any throw
  } catch (error) {
    if (error instanceof Error && /append-only/.test(error.message)) {
      db.transaction((tx) =>
        recordAudit(tx, {
          actorId: context.actorId,
          actorType: "human",
          action: "audit.tamper.attempted",
          entityType: "audit_event",
          outcome: "denied",
          after: { kind: context.kind },
          correlationId: context.correlationId,
        }),
      );
      throw new AuditTamperError(context.kind);
    }
    throw error;
  }
}
