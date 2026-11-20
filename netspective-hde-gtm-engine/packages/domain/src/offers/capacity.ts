import type { PeriodKind } from "./period.js";

// Capacity usage and status (feature 005, spec FR-018 to FR-020, research R-08). Pure. Usage is computed
// from bookings, never stored: booked, held and no-show sessions count; a cancelled one is released.

export const BOOKING_STATES = ["booked", "held", "cancelled", "no_show"] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export interface BookingLike {
  state: BookingState;
  /** Local calendar date, YYYY-MM-DD. */
  sessionDate: string;
}

export interface Usage {
  used: number;
  booked: number;
  held: number;
  noShow: number;
  cancelled: number;
}

export function usageOf(
  bookings: readonly BookingLike[],
  period: { start: string; end: string },
): Usage {
  const usage: Usage = { used: 0, booked: 0, held: 0, noShow: 0, cancelled: 0 };
  for (const b of bookings) {
    if (b.sessionDate < period.start || b.sessionDate >= period.end) continue;
    if (b.state === "booked") usage.booked++;
    else if (b.state === "held") usage.held++;
    else if (b.state === "no_show") usage.noShow++;
    else usage.cancelled++;
  }
  usage.used = usage.booked + usage.held + usage.noShow;
  return usage;
}

export interface CapacityLimit {
  periodKind: PeriodKind;
  limitSessions: number;
  /** Local date from which the limit applies. */
  effectiveFrom: string;
  setAt: string;
}

/** The limit that applies on a local day: the latest effective date not after it, then the latest set. */
export function limitInForce(history: readonly CapacityLimit[], day: string): CapacityLimit | null {
  let best: CapacityLimit | null = null;
  for (const l of history) {
    if (l.effectiveFrom > day) continue;
    if (
      best === null ||
      l.effectiveFrom > best.effectiveFrom ||
      (l.effectiveFrom === best.effectiveFrom && l.setAt > best.setAt)
    ) {
      best = l;
    }
  }
  return best;
}

export type CapacityStateName = "room" | "exhausted" | "no_limit_set";
export interface CapacityState {
  state: CapacityStateName;
  limit: number | null;
  used: number;
  held: number;
  remaining: number | null;
  utilisation: number | null;
}

/** room, exhausted or no_limit_set; with no limit it never claims unlimited room. */
export function capacityState(limit: number | null, usage: Usage): CapacityState {
  if (limit === null) {
    return {
      state: "no_limit_set",
      limit: null,
      used: usage.used,
      held: usage.held,
      remaining: null,
      utilisation: null,
    };
  }
  return {
    state: usage.used >= limit ? "exhausted" : "room",
    limit,
    used: usage.used,
    held: usage.held,
    remaining: Math.max(0, limit - usage.used),
    utilisation: limit > 0 ? usage.used / limit : null,
  };
}
