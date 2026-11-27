import type { Tx } from "@gtm/db";
import {
  toWorkshopBookedPayload,
  toWorkshopFindingsRecordedPayload,
  toWorkshopHeldPayload,
  toWorkshopRequestedPayload,
  type ActorType,
} from "@gtm/domain";
import { writeOutbox } from "../../platform/events/outbox.js";

// Outbox events of the workshops module (feature 007). Identifiers only: no name, note, finding, title,
// text, link or date. Each is written in the same transaction as the change it announces.
interface Ctx {
  userId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

function emit(tx: Tx, c: Ctx, type: string, payload: Record<string, unknown>): void {
  writeOutbox(
    tx,
    {
      type,
      actor: { id: c.userId, type: c.actorType },
      correlation_id: c.correlationId,
      causation_id: null,
      idempotency_key: null,
      provenance: { source: "workshops" },
      payload,
    },
    c.now,
  );
}

interface Subject {
  workshopId: string;
  offerId: string;
}
const subject = (s: Subject) => ({ workshop_id: s.workshopId, offer_id: s.offerId });

export const emitWorkshopRequested = (tx: Tx, c: Ctx, s: Subject & { requestId: string }): void =>
  emit(
    tx,
    c,
    "workshop.requested",
    toWorkshopRequestedPayload({ ...subject(s), request_id: s.requestId }),
  );

export const emitWorkshopBooked = (tx: Tx, c: Ctx, s: Subject & { reschedule: boolean }): void =>
  emit(
    tx,
    c,
    "workshop.booked",
    toWorkshopBookedPayload({ ...subject(s), reschedule: s.reschedule }),
  );

export const emitWorkshopHeld = (tx: Tx, c: Ctx, s: Subject): void =>
  emit(tx, c, "workshop.held", toWorkshopHeldPayload(subject(s)));

export const emitWorkshopFindingsRecorded = (
  tx: Tx,
  c: Ctx,
  s: Subject & { versionNo: number; waived: boolean },
): void =>
  emit(
    tx,
    c,
    "workshop.findings_recorded",
    toWorkshopFindingsRecordedPayload({
      ...subject(s),
      version_no: s.versionNo,
      waived: s.waived,
    }),
  );
