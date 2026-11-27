import type { SqliteDatabase } from "@gtm/db";
import type { PhiBlockEvent, PhiGuardSink } from "../../http/phi-guard.js";
import type { PhiNotifier } from "../../platform/events/phi-notifier.js";
import { recordPhiBlock } from "./phi-record.js";

// Database-backed guard sink for the request guard (spec FR-011, FR-019).

export function createPhiGuardSink(db: SqliteDatabase, notifier: PhiNotifier): PhiGuardSink {
  return {
    onBlocked(event: PhiBlockEvent) {
      db.transaction((tx) => {
        recordPhiBlock(tx, notifier, {
          entryPoint: event.entryPoint,
          action: event.action,
          ruleIds: event.decision.rule_ids,
          guardVersion: event.decision.guard_version,
          correlationId: event.correlationId,
          entityType: "request",
          entityRef: `${event.method} ${event.route}`,
          parts: event.parts,
        });
      });
    },
  };
}
