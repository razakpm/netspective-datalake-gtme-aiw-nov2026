import { z } from "zod";
import { CLAIM_CLASSES, CLAIM_STATUSES } from "../claims/types.js";
import { OFFER_STATUSES } from "../offers/types.js";

// Feature 005 event payloads (data-model.md "Events"). Identifiers and codes only: no claim, offer, note,
// wording or example text appears in any event. Strict schemas so an extra text field cannot slip in.
// Booking changes, paid-type and deliverable decisions, evidence changes and claim withdrawals are
// audit-only and emit no event (spec FR-029).

const id = z.string().min(1);

export const CapabilityUpdatedPayload = z
  .object({
    capability_id: id,
    change: z.enum(["edit", "evidence", "link", "public_status"]),
  })
  .strict();

export const OfferUpdatedPayload = z
  .object({
    offer_id: id,
    version_no: z.number().int().min(1),
    change: z.enum(["version", "status", "limitation", "score"]),
    status: z.enum(OFFER_STATUSES),
  })
  .strict();

export const OfferCapacityChangedPayload = z
  .object({
    offer_id: id,
    period_kind: z.enum(["week", "month"]),
    limit_sessions: z.number().int().min(0),
  })
  .strict();

export const ClaimCreatedPayload = z
  .object({ claim_id: id, effective_class: z.enum(CLAIM_CLASSES) })
  .strict();

export const ClaimReviewedPayload = z
  .object({
    claim_id: id,
    decision: z.enum(["approve", "reject"]),
    claim_status: z.enum(CLAIM_STATUSES),
  })
  .strict();

export const ClaimNeedsReviewPayload = z.object({ claim_id: id }).strict();

export const FEATURE005_EVENT_PAYLOADS = {
  "capability.updated": CapabilityUpdatedPayload,
  "offer.updated": OfferUpdatedPayload,
  "offer.capacity.changed": OfferCapacityChangedPayload,
  "claim.created": ClaimCreatedPayload,
  "claim.reviewed": ClaimReviewedPayload,
  "claim.needs_review": ClaimNeedsReviewPayload,
} as const;

export type CapabilityUpdated = z.infer<typeof CapabilityUpdatedPayload>;
export const toCapabilityUpdatedPayload = (p: CapabilityUpdated): CapabilityUpdated =>
  CapabilityUpdatedPayload.parse(p);
export type OfferUpdated = z.infer<typeof OfferUpdatedPayload>;
export const toOfferUpdatedPayload = (p: OfferUpdated): OfferUpdated =>
  OfferUpdatedPayload.parse(p);
export type OfferCapacityChanged = z.infer<typeof OfferCapacityChangedPayload>;
export const toOfferCapacityChangedPayload = (p: OfferCapacityChanged): OfferCapacityChanged =>
  OfferCapacityChangedPayload.parse(p);
export type ClaimCreated = z.infer<typeof ClaimCreatedPayload>;
export const toClaimCreatedPayload = (p: ClaimCreated): ClaimCreated =>
  ClaimCreatedPayload.parse(p);
export type ClaimReviewed = z.infer<typeof ClaimReviewedPayload>;
export const toClaimReviewedPayload = (p: ClaimReviewed): ClaimReviewed =>
  ClaimReviewedPayload.parse(p);
export type ClaimNeedsReview = z.infer<typeof ClaimNeedsReviewPayload>;
export const toClaimNeedsReviewPayload = (p: ClaimNeedsReview): ClaimNeedsReview =>
  ClaimNeedsReviewPayload.parse(p);
