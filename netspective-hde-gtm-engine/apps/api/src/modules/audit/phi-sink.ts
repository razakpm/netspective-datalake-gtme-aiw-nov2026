import type { SqliteDatabase } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import type { PhiBlockEvent, PhiGuardSink } from "../../http/phi-guard.js";
import type { PhiNotifier } from "../../platform/events/phi-notifier.js";
import { recordAudit } from "./writer.js";

// Database-backed guard sink (spec FR-011, FR-019): one decision row (rule IDs only), one audit event
// with outcome `failed`, and an operator alert, all in one transaction. Never receives content.

export function createPhiGuardSink(db: SqliteDatabase, notifier: PhiNotifier): PhiGuardSink {
  return {
    onBlocked(event: PhiBlockEvent) {
      db.transaction((tx) => {
        tx.prepare(
          `INSERT INTO phi_guard_decision (id, occurred_at, entry_point, decision, rule_ids, guard_version,
             correlation_id, entity_ref) VALUES (?,?,?,?,?,?,?,?)`,
        ).run(
          uuidv7(),
          new Date().toISOString(),
          event.entryPoint,
          event.action,
          JSON.stringify(event.decision.rule_ids),
          event.decision.guard_version,
          event.correlationId,
          `${event.method} ${event.route}`,
        );
        recordAudit(tx, {
          actorId: null,
          actorType: "human",
          action: event.action === "quarantine" ? "phi.quarantined" : "phi.blocked",
          entityType: "request",
          entityId: `${event.method} ${event.route}`,
          outcome: "failed",
          after: {
            entryPoint: event.entryPoint,
            ruleIds: event.decision.rule_ids,
            parts: event.parts,
          },
          correlationId: event.correlationId,
        });
        notifier.notify(tx, {
          entryPoint: event.entryPoint,
          action: event.action,
          ruleIds: event.decision.rule_ids,
          correlationId: event.correlationId,
        });
      });
    },
  };
}
