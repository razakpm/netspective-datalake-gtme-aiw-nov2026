import type { Tx } from "@gtm/db";
import { toSignalDiscoveredPayload, toSignalReviewedPayload, type ActorType } from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the signals module (task T014). Identifiers only; `signal.normalized` is not emitted
// in this feature (research R-13).

interface Ctx {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export function emitDiscovered(
  tx: Tx,
  c: Ctx,
  p: { signalId: string; accountId: string; typeKey: string; merged: boolean },
): void {
  writeOutbox(
    tx,
    {
      type: "signal.discovered",
      actor: { id: c.actorId, type: c.actorType },
      correlation_id: c.correlationId,
      causation_id: null,
      idempotency_key: null,
      payload: toSignalDiscoveredPayload({
        signal_id: p.signalId,
        account_id: p.accountId,
        type_key: p.typeKey,
        merged: p.merged,
      }),
      provenance: { source: "signals" },
    },
    c.now,
  );
}

export function emitReviewed(
  tx: Tx,
  c: Ctx,
  p: {
    signalId: string;
    decision: "approve" | "reject" | "contradict" | "reverify" | "clear_flag";
    reviewStatus: "pending" | "approved" | "rejected" | "contradictory";
  },
): void {
  writeOutbox(
    tx,
    {
      type: "signal.reviewed",
      actor: { id: c.actorId, type: c.actorType },
      correlation_id: c.correlationId,
      causation_id: null,
      idempotency_key: null,
      payload: toSignalReviewedPayload({
        signal_id: p.signalId,
        decision: p.decision,
        review_status: p.reviewStatus,
      }),
      provenance: { source: "signals" },
    },
    c.now,
  );
}
