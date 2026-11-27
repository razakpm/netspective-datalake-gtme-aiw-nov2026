import { z } from "zod";

// Feature 007 event payloads (data-model.md "Events"). Identifiers and codes only: no name, note, finding,
// title, text, link or date appears in any event. Strict schemas so a text field cannot slip in.

const id = z.string().min(1);
const workshop = { workshop_id: id, offer_id: id };

export const WorkshopRequestedPayload = z.object({ ...workshop, request_id: id }).strict();
export const WorkshopBookedPayload = z.object({ ...workshop, reschedule: z.boolean() }).strict();
export const WorkshopHeldPayload = z.object(workshop).strict();
export const WorkshopFindingsRecordedPayload = z
  .object({ ...workshop, version_no: z.number().int().min(1), waived: z.boolean() })
  .strict();

export const FEATURE007_EVENT_PAYLOADS = {
  "workshop.requested": WorkshopRequestedPayload,
  "workshop.booked": WorkshopBookedPayload,
  "workshop.held": WorkshopHeldPayload,
  "workshop.findings_recorded": WorkshopFindingsRecordedPayload,
} as const;

export type WorkshopRequested = z.infer<typeof WorkshopRequestedPayload>;
export const toWorkshopRequestedPayload = (p: WorkshopRequested): WorkshopRequested =>
  WorkshopRequestedPayload.parse(p);
export type WorkshopBooked = z.infer<typeof WorkshopBookedPayload>;
export const toWorkshopBookedPayload = (p: WorkshopBooked): WorkshopBooked =>
  WorkshopBookedPayload.parse(p);
export type WorkshopHeld = z.infer<typeof WorkshopHeldPayload>;
export const toWorkshopHeldPayload = (p: WorkshopHeld): WorkshopHeld =>
  WorkshopHeldPayload.parse(p);
export type WorkshopFindingsRecorded = z.infer<typeof WorkshopFindingsRecordedPayload>;
export const toWorkshopFindingsRecordedPayload = (
  p: WorkshopFindingsRecorded,
): WorkshopFindingsRecorded => WorkshopFindingsRecordedPayload.parse(p);
