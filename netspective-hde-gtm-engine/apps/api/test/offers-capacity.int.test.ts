import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T038: limits, bookings and the computed capacity status (quickstart V15 to V19; spec FR-017 to
// FR-020, SC-005). The clock starts on Thursday 2026-11-19; Offer 6 has 3 per month and Offer 1 3 per week.
const book = (
  h: ReturnType<typeof buildCatalogueHarness>,
  offer: string,
  date: string,
  ref?: string,
) =>
  h.bookings.record(h.actor("lead"), offer, {
    sessionDate: date,
    ...(ref ? { externalRef: ref } : {}),
  });

describe("capacity status", () => {
  it("reads the seeded limits as room with nothing used", () => {
    const h = buildCatalogueHarness();
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      offerId: "offer-6",
      state: "room",
      periodKind: "month",
      periodStart: "2026-11-01",
      periodEnd: "2026-12-01",
      limit: 3,
      used: 0,
      remaining: 3,
      utilisation: 0,
      offerStatus: "approved",
    });
    expect(h.capacity.capacityStatus("offer-1", h.now())).toMatchObject({
      state: "room",
      periodKind: "week",
      periodStart: "2026-11-16",
      periodEnd: "2026-11-23",
      limit: 3,
    });
  });

  it("is exhausted once usage reaches the limit and refuses the next booking", () => {
    const h = buildCatalogueHarness();
    for (const d of ["2026-11-20", "2026-11-21", "2026-11-25"]) book(h, "offer-6", d);
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "exhausted",
      limit: 3,
      used: 3,
      remaining: 0,
      utilisation: 1,
    });
    expect(() => book(h, "offer-6", "2026-11-28")).toThrow(/full|capacity/i);
    expect(h.count("offer_session_booking")).toBe(3);
    expect(h.audit("offer.booking.record.refused")[0]?.after_summary).toContain(
      "capacity_exhausted",
    );
  });

  it("answers for another period without mixing usage", () => {
    const h = buildCatalogueHarness();
    for (const d of ["2026-11-20", "2026-11-21", "2026-11-25"]) book(h, "offer-6", d);
    expect(h.capacity.capacityStatus("offer-6", new Date("2026-12-02T10:00:00Z"))).toMatchObject({
      state: "room",
      periodStart: "2026-12-01",
      used: 0,
    });
    book(h, "offer-6", "2026-12-03");
    expect(h.capacity.capacityStatus("offer-6", new Date("2026-12-02T10:00:00Z")).used).toBe(1);
    expect(h.capacity.capacityStatus("offer-6", h.now()).used).toBe(3);
  });

  it("releases a cancelled session, keeps a no-show and reports held sessions separately", () => {
    const h = buildCatalogueHarness();
    const a = book(h, "offer-6", "2026-11-20");
    const b = book(h, "offer-6", "2026-11-21");
    const c = book(h, "offer-6", "2026-11-25");
    h.bookings.markHeld(h.actor("lead"), a.id);
    h.bookings.markNoShow(h.actor("lead"), b.id);
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "exhausted",
      used: 3,
      held: 1,
    });
    h.bookings.cancel(h.actor("lead"), c.id);
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "room",
      used: 2,
      held: 1,
      remaining: 1,
    });
    expect(book(h, "offer-6", "2026-11-26").state).toBe("booked");
  });

  it("is no_limit_set for an offer without a limit, never unlimited, and still accepts bookings", () => {
    const h = buildCatalogueHarness();
    book(h, "offer-2", "2026-11-20");
    expect(h.capacity.capacityStatus("offer-2", h.now())).toEqual({
      offerId: "offer-2",
      state: "no_limit_set",
      periodKind: "month",
      periodStart: "2026-11-01",
      periodEnd: "2026-12-01",
      limit: null,
      used: 1,
      held: 0,
      remaining: null,
      utilisation: null,
      offerStatus: "draft",
    });
  });

  it("uses the business time zone to place the instant in a period", () => {
    const h = buildCatalogueHarness({ businessTimeZone: "America/New_York" });
    expect(h.capacity.capacityStatus("offer-6", new Date("2026-12-01T04:30:00Z")).periodStart).toBe(
      "2026-11-01",
    );
    expect(h.capacity.capacityStatus("offer-6", new Date("2026-12-01T05:00:00Z")).periodStart).toBe(
      "2026-12-01",
    );
  });

  it("keeps usage and reports the new status when the offer is withdrawn", () => {
    const h = buildCatalogueHarness();
    book(h, "offer-6", "2026-11-20");
    h.offerStatus.moveStatus(h.actor("lead"), "offer-6", 1, "withdrawn", "Retired");
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      used: 1,
      offerStatus: "withdrawn",
    });
  });

  it("answers an unknown offer with a not-found problem", () => {
    const h = buildCatalogueHarness();
    expect(() => h.capacity.capacityStatus("offer-99", h.now())).toThrow(/not found/i);
  });
});

describe("limits and their history", () => {
  it("keeps the previous value, who changed it and when, and emits identifiers only", () => {
    const h = buildCatalogueHarness();
    h.capacity.setLimit(h.actor("lead"), "offer-6", {
      periodKind: "month",
      limitSessions: 5,
      reason: "More room",
    });
    const history = h.capacity.listLimits(h.actor("lead"), "offer-6");
    expect(history.map((l) => [l.limitSessions, l.setBy])).toEqual([
      [3, "seed"],
      [5, "lead-1"],
    ]);
    expect(h.outbox("offer.capacity.changed")).toEqual([
      { offer_id: "offer-6", period_kind: "month", limit_sessions: 5 },
    ]);
    expect(h.audit("offer.capacity.set")).toHaveLength(1);
    expect(h.anyText(/More room/)).toBe(false);
  });

  it("applies a new limit from its effective date, so an earlier day still sees the old one", () => {
    const h = buildCatalogueHarness();
    const before = h.now();
    h.advanceDays(10);
    h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "month", limitSessions: 1 });
    expect(h.capacity.capacityStatus("offer-6", before).limit).toBe(3);
    expect(h.capacity.capacityStatus("offer-6", h.now()).limit).toBe(1);
  });

  it("clears exhausted when the limit is raised", () => {
    const h = buildCatalogueHarness();
    for (const d of ["2026-11-20", "2026-11-21", "2026-11-25"]) book(h, "offer-6", d);
    h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "month", limitSessions: 4 });
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "room",
      remaining: 1,
    });
  });

  it("accepts a limit of zero and a switch from month to week", () => {
    const h = buildCatalogueHarness();
    h.capacity.setLimit(h.actor("lead"), "offer-6", { periodKind: "week", limitSessions: 0 });
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({
      state: "exhausted",
      periodKind: "week",
      limit: 0,
    });
  });

  it("refuses a negative limit, an unknown period kind and PHI-like reasons", () => {
    const h = buildCatalogueHarness();
    for (const bad of [
      { periodKind: "month", limitSessions: -1 },
      { periodKind: "day", limitSessions: 1 },
      { periodKind: "month", limitSessions: 1.5 },
      { periodKind: "month", limitSessions: 1, reason: "Call 123-45-6789 first" },
    ]) {
      expect(() => h.capacity.setLimit(h.actor("lead"), "offer-6", bad)).toThrow();
    }
    expect(h.count("offer_capacity")).toBe(2);
  });

  it("needs offers.capacity.edit", () => {
    const h = buildCatalogueHarness();
    for (const who of ["analyst", "marketing", "executive"] as const) {
      expect(
        () =>
          h.capacity.setLimit(h.actor(who), "offer-6", { periodKind: "month", limitSessions: 9 }),
        who,
      ).toThrow(/permission/);
    }
    expect(h.count("offer_capacity")).toBe(2);
  });
});

describe("bookings", () => {
  it("labels manual entries and records who and when", () => {
    const h = buildCatalogueHarness();
    const booking = book(h, "offer-6", "2026-11-20", "ws-1");
    expect(booking).toMatchObject({
      source: "manual",
      state: "booked",
      sessionDate: "2026-11-20",
      recordedBy: "lead-1",
    });
    expect(h.audit("offer.booking.record")).toHaveLength(1);
  });

  it("refuses a duplicate external reference for the same offer only", () => {
    const h = buildCatalogueHarness();
    book(h, "offer-6", "2026-11-20", "ws-1");
    expect(() => book(h, "offer-6", "2026-11-21", "ws-1")).toThrow(/already/i);
    expect(book(h, "offer-1", "2026-11-20", "ws-1").externalRef).toBe("ws-1");
  });

  it("moves a session between periods, releasing the first and counting the second", () => {
    const h = buildCatalogueHarness();
    const moved = book(h, "offer-6", "2026-11-20");
    h.bookings.reschedule(h.actor("lead"), moved.id, "2026-12-04");
    expect(h.capacity.capacityStatus("offer-6", h.now()).used).toBe(0);
    expect(h.capacity.capacityStatus("offer-6", new Date("2026-12-04T10:00:00Z")).used).toBe(1);
  });

  it("refuses a reschedule into a full period and leaves the booking where it was", () => {
    const h = buildCatalogueHarness();
    for (const d of ["2026-12-01", "2026-12-02", "2026-12-03"]) book(h, "offer-6", d);
    const moving = book(h, "offer-6", "2026-11-20");
    expect(() => h.bookings.reschedule(h.actor("lead"), moving.id, "2026-12-10")).toThrow(
      /full|capacity/i,
    );
    expect(
      h.bookings.list(h.actor("lead"), "offer-6").find((x) => x.id === moving.id)?.sessionDate,
    ).toBe("2026-11-20");
    expect(h.capacity.capacityStatus("offer-6", h.now()).used).toBe(1);
  });

  it("lets a session move inside its own full period", () => {
    const h = buildCatalogueHarness();
    const first = book(h, "offer-6", "2026-11-20");
    book(h, "offer-6", "2026-11-21");
    book(h, "offer-6", "2026-11-25");
    expect(h.bookings.reschedule(h.actor("lead"), first.id, "2026-11-27").sessionDate).toBe(
      "2026-11-27",
    );
  });

  it("allows only booked sessions to change state", () => {
    const h = buildCatalogueHarness();
    const s = book(h, "offer-6", "2026-11-20");
    h.bookings.cancel(h.actor("lead"), s.id);
    expect(() => h.bookings.markHeld(h.actor("lead"), s.id)).toThrow(/cannot/i);
    expect(() => h.bookings.reschedule(h.actor("lead"), s.id, "2026-11-22")).toThrow(/cannot/i);
  });

  it("refuses a date that is not a real date", () => {
    const h = buildCatalogueHarness();
    expect(() => book(h, "offer-6", "2026-02-30")).toThrow(/Invalid fields/);
  });

  it("needs offers.bookings.edit to change and offers.read to list", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.bookings.record(h.actor("analyst"), "offer-6", { sessionDate: "2026-11-20" }),
    ).toThrow(/permission/);
    expect(h.bookings.list(h.actor("analyst"), "offer-6")).toEqual([]);
  });

  it("emits no event for a booking change", () => {
    const h = buildCatalogueHarness();
    const s = book(h, "offer-6", "2026-11-20");
    h.bookings.cancel(h.actor("lead"), s.id);
    expect(h.count("outbox_event", "type LIKE 'offer.%'")).toBe(0);
  });
});
