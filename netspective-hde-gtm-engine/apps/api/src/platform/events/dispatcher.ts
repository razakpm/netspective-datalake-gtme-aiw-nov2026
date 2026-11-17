import type { EventEnvelope } from "@gtm/domain";
import type { SqliteDatabase } from "@gtm/db";

export type EventHandler = (event: EventEnvelope) => void | Promise<void>;

interface Row {
  id: string;
  type: string;
  schema_version: number;
  occurred_at: string;
  actor_id: string | null;
  actor_type: "human" | "ai" | "system";
  correlation_id: string | null;
  causation_id: string | null;
  idempotency_key: string | null;
  payload: string;
  provenance: string;
}

/**
 * In-process dispatcher. Delivery is at-least-once: an event is marked dispatched only after every
 * handler succeeded, so a crash in between redelivers it. Handlers deduplicate on event_id.
 * (Single process on SQLite; the Postgres version claims rows with FOR UPDATE SKIP LOCKED.)
 */
export class Dispatcher {
  private readonly handlers = new Map<string, EventHandler[]>();

  constructor(private readonly db: SqliteDatabase) {}

  on(type: string, handler: EventHandler): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  async dispatchPending(limit = 100): Promise<number> {
    const rows = this.db.raw
      .prepare(
        "SELECT * FROM outbox_event WHERE dispatched_at IS NULL ORDER BY occurred_at, id LIMIT ?",
      )
      .all(limit) as unknown as Row[];
    let delivered = 0;
    for (const row of rows) {
      const event: EventEnvelope = {
        event_id: row.id,
        type: row.type,
        schema_version: row.schema_version,
        occurred_at: row.occurred_at,
        actor: { id: row.actor_id, type: row.actor_type },
        correlation_id: row.correlation_id,
        causation_id: row.causation_id,
        idempotency_key: row.idempotency_key,
        payload: JSON.parse(row.payload),
        provenance: JSON.parse(row.provenance),
      };
      for (const handler of this.handlers.get(row.type) ?? []) await handler(event);
      this.db.raw
        .prepare("UPDATE outbox_event SET dispatched_at = ? WHERE id = ? AND dispatched_at IS NULL")
        .run(new Date().toISOString(), row.id);
      delivered += 1;
    }
    return delivered;
  }
}
