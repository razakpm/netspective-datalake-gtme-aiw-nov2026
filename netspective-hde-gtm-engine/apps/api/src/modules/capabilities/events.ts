import type { Tx } from "@gtm/db";
import { toCapabilityUpdatedPayload, type ActorType } from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the capabilities module (feature 005). Identifiers and the change type only.
interface Ctx {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export function emitCapabilityUpdated(
  tx: Tx,
  c: Ctx,
  p: { capabilityId: string; change: "edit" | "evidence" | "link" | "public_status" },
): void {
  writeOutbox(
    tx,
    {
      type: "capability.updated",
      actor: { id: c.actorId, type: c.actorType },
      correlation_id: c.correlationId,
      causation_id: null,
      idempotency_key: null,
      provenance: { source: "capabilities" },
      payload: toCapabilityUpdatedPayload({ capability_id: p.capabilityId, change: p.change }),
    },
    c.now,
  );
}
