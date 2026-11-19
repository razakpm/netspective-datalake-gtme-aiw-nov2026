import type { Tx } from "@gtm/db";
import {
  toHypothesisCreatedPayload,
  toHypothesisUpdatedPayload,
  type ActorType,
} from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the hypotheses module (task T043). Identifiers only: no statement, note or quote text.
interface Ctx {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

const base = (c: Ctx, type: string) => ({
  type,
  actor: { id: c.actorId, type: c.actorType },
  correlation_id: c.correlationId,
  causation_id: null,
  idempotency_key: null,
  provenance: { source: "hypotheses" },
});

export function emitCreated(
  tx: Tx,
  c: Ctx,
  p: { hypothesisId: string; accountId: string; origin: "analyst" | "ai" },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "hypothesis.created"),
      payload: toHypothesisCreatedPayload({
        hypothesis_id: p.hypothesisId,
        account_id: p.accountId,
        origin: p.origin,
      }),
    },
    c.now,
  );
}

export function emitUpdated(
  tx: Tx,
  c: Ctx,
  p: {
    hypothesisId: string;
    accountId: string;
    change: "status" | "stale" | "edit" | "link" | "flag";
    status: "untested" | "strengthening" | "weakening" | "validated" | "rejected" | "stale";
  },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "hypothesis.updated"),
      payload: toHypothesisUpdatedPayload({
        hypothesis_id: p.hypothesisId,
        account_id: p.accountId,
        change: p.change,
        status: p.status,
      }),
    },
    c.now,
  );
}
