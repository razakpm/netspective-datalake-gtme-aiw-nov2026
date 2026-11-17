import type { ActorType } from "../actors.js";

// Versioned event envelope (ADR-013). Consumers deduplicate on event_id; delivery is at-least-once.

export interface EventEnvelope<P = unknown> {
  event_id: string;
  type: string;
  schema_version: number;
  occurred_at: string;
  actor: { id: string | null; type: ActorType };
  correlation_id: string | null;
  causation_id: string | null;
  idempotency_key: string | null;
  payload: P;
  provenance: Record<string, unknown>;
}
