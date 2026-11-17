import { guardValue, type EventEnvelope } from "@gtm/domain";
import type { Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";

export class OutboxRejectedError extends Error {
  readonly ruleIds: string[];
  constructor(ruleIds: string[]) {
    super(`outbox payload rejected by the PHI guard (${ruleIds.join(", ")})`);
    this.name = "OutboxRejectedError";
    this.ruleIds = ruleIds;
  }
}

export type NewEvent = Omit<EventEnvelope, "event_id" | "occurred_at" | "schema_version"> & {
  schema_version?: number;
};

/** Write an event in the caller's transaction (ADR-013). The payload passes the PHI guard first. */
export function writeOutbox(tx: Tx, event: NewEvent, now: () => Date = () => new Date()): string {
  const decision = guardValue(event.payload);
  if (decision.decision !== "allow") throw new OutboxRejectedError(decision.rule_ids);
  const id = uuidv7();
  tx.prepare(
    `INSERT INTO outbox_event (id, type, schema_version, occurred_at, actor_id, actor_type,
       correlation_id, causation_id, idempotency_key, payload, provenance)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    event.type,
    event.schema_version ?? 1,
    now().toISOString(),
    event.actor.id,
    event.actor.type,
    event.correlation_id,
    event.causation_id,
    event.idempotency_key,
    JSON.stringify(event.payload),
    JSON.stringify(event.provenance),
  );
  return id;
}
