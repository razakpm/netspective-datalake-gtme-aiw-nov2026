import { describe, expect, it } from "vitest";
import { capacityState, limitInForce, usageOf, type CapacityLimit } from "../../src/index.js";

// Task T037: usage counts booked, held and no-show sessions; a cancelled session is released (FR-018 to
// FR-020). The state is room, exhausted or no_limit_set, never "unlimited".
const b = (state: "booked" | "held" | "cancelled" | "no_show", sessionDate: string) => ({
  state,
  sessionDate,
});
const P = { start: "2026-11-01", end: "2026-12-01" };

describe("usageOf", () => {
  it("counts booked, held and no_show in the period and releases cancelled", () => {
    const usage = usageOf(
      [
        b("booked", "2026-11-02"),
        b("held", "2026-11-10"),
        b("no_show", "2026-11-12"),
        b("cancelled", "2026-11-15"),
        b("booked", "2026-11-30"),
      ],
      P,
    );
    expect(usage).toEqual({ used: 4, booked: 2, held: 1, noShow: 1, cancelled: 1 });
  });
  it("ignores sessions outside the period, on either side, and includes the first day but not the end", () => {
    expect(usageOf([b("booked", "2026-10-31"), b("booked", "2026-12-01")], P).used).toBe(0);
    expect(usageOf([b("booked", "2026-11-01")], P).used).toBe(1);
    expect(usageOf([b("booked", "2026-11-30")], P).used).toBe(1);
  });
  it("is zero for no bookings", () => {
    expect(usageOf([], P)).toEqual({ used: 0, booked: 0, held: 0, noShow: 0, cancelled: 0 });
  });
});

describe("limitInForce", () => {
  const history: CapacityLimit[] = [
    {
      periodKind: "month",
      limitSessions: 3,
      effectiveFrom: "2026-01-01",
      setAt: "2026-01-01T00:00:00.000Z",
    },
    {
      periodKind: "month",
      limitSessions: 5,
      effectiveFrom: "2026-11-10",
      setAt: "2026-11-09T00:00:00.000Z",
    },
    {
      periodKind: "week",
      limitSessions: 2,
      effectiveFrom: "2026-12-01",
      setAt: "2026-11-20T00:00:00.000Z",
    },
  ];
  it("is the latest row whose effective date is not after the day asked about", () => {
    expect(limitInForce(history, "2026-11-09")).toMatchObject({
      limitSessions: 3,
      periodKind: "month",
    });
    expect(limitInForce(history, "2026-11-10")).toMatchObject({ limitSessions: 5 });
    expect(limitInForce(history, "2026-12-01")).toMatchObject({
      limitSessions: 2,
      periodKind: "week",
    });
  });
  it("is null before any limit applies", () => {
    expect(limitInForce(history, "2025-12-31")).toBeNull();
    expect(limitInForce([], "2026-11-19")).toBeNull();
  });
  it("breaks a tie on the effective date by the time the limit was set", () => {
    const tie: CapacityLimit[] = [
      {
        periodKind: "month",
        limitSessions: 3,
        effectiveFrom: "2026-11-01",
        setAt: "2026-11-01T08:00:00.000Z",
      },
      {
        periodKind: "month",
        limitSessions: 4,
        effectiveFrom: "2026-11-01",
        setAt: "2026-11-01T09:00:00.000Z",
      },
    ];
    expect(limitInForce(tie, "2026-11-19")?.limitSessions).toBe(4);
  });
});

describe("capacityState", () => {
  const usage = (used: number, held = 0) => ({
    used,
    booked: used - held,
    held,
    noShow: 0,
    cancelled: 0,
  });
  it("is room while used is below the limit, with remaining and utilisation", () => {
    expect(capacityState(3, usage(1))).toEqual({
      state: "room",
      limit: 3,
      used: 1,
      held: 0,
      remaining: 2,
      utilisation: 1 / 3,
    });
  });
  it("is exhausted at or above the limit", () => {
    expect(capacityState(3, usage(3))).toMatchObject({
      state: "exhausted",
      remaining: 0,
      utilisation: 1,
    });
    expect(capacityState(3, usage(4))).toMatchObject({
      state: "exhausted",
      remaining: 0,
      utilisation: 4 / 3,
    });
  });
  it("is exhausted for a limit of zero, with no utilisation figure", () => {
    expect(capacityState(0, usage(0))).toEqual({
      state: "exhausted",
      limit: 0,
      used: 0,
      held: 0,
      remaining: 0,
      utilisation: null,
    });
  });
  it("is no_limit_set without a limit and never claims unlimited room", () => {
    const s = capacityState(null, usage(2, 1));
    expect(s).toEqual({
      state: "no_limit_set",
      limit: null,
      used: 2,
      held: 1,
      remaining: null,
      utilisation: null,
    });
  });
});
