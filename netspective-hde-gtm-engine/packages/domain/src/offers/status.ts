import { OFFER_STATUSES, type OfferStatus } from "./types.js";

// The offer status machine (feature 005, spec FR-010). Pure.
//   draft -> internally_reviewed -> approved -> available
//   any live status -> withdrawn; approved or available -> expired
//   nothing leaves withdrawn or expired

const NEXT: Readonly<Record<OfferStatus, readonly OfferStatus[]>> = {
  draft: ["internally_reviewed", "withdrawn"],
  internally_reviewed: ["approved", "withdrawn"],
  approved: ["available", "withdrawn", "expired"],
  available: ["withdrawn", "expired"],
  withdrawn: [],
  expired: [],
};

export type TransitionResult =
  { ok: true } | { ok: false; code: "invalid_transition"; reason: string };

const label = (s: OfferStatus) => s.replace("_", " ");

export function allowedNext(from: OfferStatus): readonly OfferStatus[] {
  return NEXT[from];
}

export function checkOfferTransition(from: OfferStatus, to: OfferStatus): TransitionResult {
  if (NEXT[from].includes(to)) return { ok: true };
  const next = NEXT[from];
  const reason =
    next.length === 0
      ? `An offer version that is ${label(from)} cannot move to another status.`
      : `An offer version cannot move from ${label(from)} to ${label(to)}. It can move to: ${next.map(label).join(", ")}.`;
  return { ok: false, code: "invalid_transition", reason };
}

export const isOfferStatus = (value: string): value is OfferStatus =>
  (OFFER_STATUSES as readonly string[]).includes(value);
