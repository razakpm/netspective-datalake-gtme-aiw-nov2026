import type { Tx } from "@gtm/db";
import {
  toLeadMagnetDownloadedPayload,
  toOfferRequestedPayload,
  type ActorType,
} from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the engagement module (feature 006). Identifiers only: no email, name, text or link.
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
  provenance: { source: "engagement" },
});

export function emitOfferRequested(
  tx: Tx,
  c: Ctx,
  p: { requestId: string; offerId: string; kind: "download" | "working_session" | "intake" },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "offer.requested"),
      payload: toOfferRequestedPayload({
        request_id: p.requestId,
        offer_id: p.offerId,
        kind: p.kind,
      }),
    },
    c.now,
  );
}

export function emitLeadMagnetDownloaded(
  tx: Tx,
  c: Ctx,
  p: { downloadId: string; requestId: string; delivered: boolean },
): void {
  writeOutbox(
    tx,
    {
      ...base(c, "lead_magnet.downloaded"),
      payload: toLeadMagnetDownloadedPayload({
        download_id: p.downloadId,
        request_id: p.requestId,
        delivered: p.delivered,
      }),
    },
    c.now,
  );
}
