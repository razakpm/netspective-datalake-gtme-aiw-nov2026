import { z } from "zod";

// Feature 003 event payloads (data-model.md "Events"). Identifiers only: no observation, excerpt or
// reason text (spec FR-041). `signal.normalized` is intentionally absent (research R-13).

export const SignalDiscoveredPayload = z
  .object({
    signal_id: z.string().min(1),
    account_id: z.string().min(1),
    type_key: z.string().min(1),
    merged: z.boolean(),
  })
  .strict();

export const SignalReviewedPayload = z
  .object({
    signal_id: z.string().min(1),
    decision: z.enum(["approve", "reject", "contradict", "reverify", "clear_flag"]),
    review_status: z.enum(["pending", "approved", "rejected", "contradictory"]),
  })
  .strict();

export const FEATURE003_EVENT_PAYLOADS = {
  "signal.discovered": SignalDiscoveredPayload,
  "signal.reviewed": SignalReviewedPayload,
} as const;

export type SignalDiscovered = z.infer<typeof SignalDiscoveredPayload>;
export const toSignalDiscoveredPayload = (p: SignalDiscovered): SignalDiscovered =>
  SignalDiscoveredPayload.parse(p);
export type SignalReviewed = z.infer<typeof SignalReviewedPayload>;
export const toSignalReviewedPayload = (p: SignalReviewed): SignalReviewed =>
  SignalReviewedPayload.parse(p);
