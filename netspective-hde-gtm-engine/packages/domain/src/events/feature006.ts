import { z } from "zod";

// Feature 006 event payloads (data-model.md "Events"). Identifiers and codes only: no email, name, role,
// explanation, decision text or link appears in any event. Strict schemas so a text field cannot slip in.
// A refused or deduplicated submission emits nothing.

const id = z.string().min(1);

export const OfferRecommendedPayload = z
  .object({
    recommendation_id: id,
    account_id: id,
    outcome: z.enum(["offer", "research", "no_action"]),
    outreach: z.enum(["allowed", "blocked"]),
    rule_set_version: z.number().int().min(1),
  })
  .strict();

export const OfferRequestedPayload = z
  .object({
    request_id: id,
    offer_id: id,
    kind: z.enum(["download", "working_session", "intake"]),
  })
  .strict();

export const LeadMagnetDownloadedPayload = z
  .object({ download_id: id, request_id: id, delivered: z.boolean() })
  .strict();

export const FEATURE006_EVENT_PAYLOADS = {
  "offer.recommended": OfferRecommendedPayload,
  "offer.requested": OfferRequestedPayload,
  "lead_magnet.downloaded": LeadMagnetDownloadedPayload,
} as const;

export type OfferRecommended = z.infer<typeof OfferRecommendedPayload>;
export const toOfferRecommendedPayload = (p: OfferRecommended): OfferRecommended =>
  OfferRecommendedPayload.parse(p);
export type OfferRequested = z.infer<typeof OfferRequestedPayload>;
export const toOfferRequestedPayload = (p: OfferRequested): OfferRequested =>
  OfferRequestedPayload.parse(p);
export type LeadMagnetDownloaded = z.infer<typeof LeadMagnetDownloadedPayload>;
export const toLeadMagnetDownloadedPayload = (p: LeadMagnetDownloaded): LeadMagnetDownloaded =>
  LeadMagnetDownloadedPayload.parse(p);
