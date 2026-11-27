import type { Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import type { GuardAction } from "@gtm/domain";
import type { PhiNotifier } from "../../platform/events/phi-notifier.js";
import { recordAudit } from "./writer.js";

// What happens when the boundary guard flags content (spec FR-011, FR-019): one decision row (rule ids
// only), one audit event with outcome `failed`, and an operator alert (rate limited per entry point), all
// in the caller's transaction. Never receives content.

export interface PhiBlockRecord {
  entryPoint: string;
  action: GuardAction;
  ruleIds: string[];
  guardVersion: string;
  correlationId: string | null;
  entityType: string;
  /** A route or a record identifier, never content. */
  entityRef: string;
  /** The parts of the input that matched, when known. */
  parts?: string[] | undefined;
}

export function recordPhiBlock(
  tx: Tx,
  notifier: PhiNotifier,
  block: PhiBlockRecord,
  now: () => Date = () => new Date(),
): void {
  tx.prepare(
    `INSERT INTO phi_guard_decision (id, occurred_at, entry_point, decision, rule_ids, guard_version,
       correlation_id, entity_ref) VALUES (?,?,?,?,?,?,?,?)`,
  ).run(
    uuidv7(),
    now().toISOString(),
    block.entryPoint,
    block.action,
    JSON.stringify(block.ruleIds),
    block.guardVersion,
    block.correlationId,
    block.entityRef,
  );
  recordAudit(
    tx,
    {
      actorId: null,
      actorType: "human",
      action: block.action === "quarantine" ? "phi.quarantined" : "phi.blocked",
      entityType: block.entityType,
      entityId: block.entityRef,
      outcome: "failed",
      after: {
        entryPoint: block.entryPoint,
        ruleIds: block.ruleIds,
        ...(block.parts ? { parts: block.parts } : {}),
      },
      correlationId: block.correlationId,
    },
    now,
  );
  notifier.notify(tx, {
    entryPoint: block.entryPoint,
    action: block.action,
    ruleIds: block.ruleIds,
    correlationId: block.correlationId,
  });
}
