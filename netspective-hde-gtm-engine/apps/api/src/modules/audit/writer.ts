import { computeRowHash, summarize, type AuditEventInput } from "@gtm/domain";
import type { Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";

/**
 * Record an audit event inside the caller's transaction, so the state change and its audit row commit
 * or roll back together (FR-010). There is deliberately no update or delete function (FR-011).
 */
export function recordAudit(
  tx: Tx,
  event: AuditEventInput,
  now: () => Date = () => new Date(),
): string {
  const row = {
    id: uuidv7(),
    occurred_at: now().toISOString(),
    actor_id: event.actorId,
    actor_type: event.actorType,
    action: event.action,
    entity_type: event.entityType,
    entity_id: event.entityId ?? null,
    outcome: event.outcome,
    before_summary: summarize(event.before),
    after_summary: summarize(event.after),
    correlation_id: event.correlationId ?? null,
  };
  // Writers are serialised by the transaction (BEGIN IMMEDIATE on SQLite; an advisory lock on
  // Postgres), so the previous hash read here is the true chain head.
  const head = tx.prepare("SELECT row_hash FROM audit_event ORDER BY rowid DESC LIMIT 1").get() as
    { row_hash: string | null } | undefined;
  const prevHash = head?.row_hash ?? null;
  tx.prepare(
    `INSERT INTO audit_event (id, occurred_at, actor_id, actor_type, action, entity_type, entity_id,
       outcome, before_summary, after_summary, correlation_id, prev_hash, row_hash)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id,
    row.occurred_at,
    row.actor_id,
    row.actor_type,
    row.action,
    row.entity_type,
    row.entity_id,
    row.outcome,
    row.before_summary,
    row.after_summary,
    row.correlation_id,
    prevHash,
    computeRowHash(row, prevHash),
  );
  return row.id;
}
