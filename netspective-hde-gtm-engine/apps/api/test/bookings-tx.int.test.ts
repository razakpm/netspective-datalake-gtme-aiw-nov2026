import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { CatalogueRefusal } from "../src/platform/catalogue.js";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Feature 007 task T015: transaction-level booking methods for workshops, and workshop-owned bookings
// refusing change through feature 005. The clock starts on Thursday 2026-11-19; Offer 6 has 3 per month.
type Harness = ReturnType<typeof buildCatalogueHarness>;
const operator = (h: Harness) => h.actor("operator");
const record = (h: Harness, date: string) =>
  h.db.transaction((tx) => h.bookings.recordIn(tx, operator(h), "offer-6", { sessionDate: date }));
const row = (h: Harness, id: string) =>
  h.db.raw
    .prepare("SELECT state, session_date, source FROM offer_session_booking WHERE id = ?")
    .get(id) as { state: string; session_date: string; source: string };
const refusal = (fn: () => unknown): CatalogueRefusal => {
  try {
    fn();
  } catch (error) {
    if (error instanceof CatalogueRefusal) return error;
    throw error;
  }
  throw new Error("expected a refusal");
};

describe("transaction-level bookings", () => {
  it("records a workshop booking without the booking permission, and audits it", () => {
    const h = buildCatalogueHarness();
    expect(operator(h).permissions).not.toContain("offers.bookings.edit");
    const made = record(h, "2026-11-20");
    expect(made).toMatchObject({ state: "booked", source: "workshop", periodStart: "2026-11-01" });
    expect(row(h, made.id)).toMatchObject({ source: "workshop" });
    expect(h.audit("offer.booking.record")[0]).toMatchObject({
      actor_id: "operator-1",
      entity_id: made.id,
      outcome: "success",
    });
    expect(h.capacity.capacityStatus("offer-6", h.now()).used).toBe(1);
  });

  it("reschedules, cancels, holds and records a no-show, auditing each", () => {
    const h = buildCatalogueHarness();
    const [a, b, c] = ["2026-11-20", "2026-11-21", "2026-11-25"].map((d) => record(h, d));
    h.db.transaction((tx) => h.bookings.rescheduleIn(tx, operator(h), a!.id, "2026-12-03"));
    expect(row(h, a!.id).session_date).toBe("2026-12-03");
    h.db.transaction((tx) => h.bookings.cancelIn(tx, operator(h), a!.id));
    h.db.transaction((tx) => h.bookings.holdIn(tx, operator(h), b!.id));
    h.db.transaction((tx) => h.bookings.noShowIn(tx, operator(h), c!.id));
    expect([row(h, a!.id).state, row(h, b!.id).state, row(h, c!.id).state]).toEqual([
      "cancelled",
      "held",
      "no_show",
    ]);
    for (const op of ["reschedule", "cancel", "hold", "no_show"]) {
      expect(h.audit(`offer.booking.${op}`), op).toHaveLength(1);
    }
  });

  it("applies the same capacity rule, also to a reschedule into a full period", () => {
    const h = buildCatalogueHarness();
    for (const d of ["2026-11-20", "2026-11-21", "2026-11-25"]) record(h, d);
    const full = refusal(() => record(h, "2026-11-28"));
    expect(full.status).toBe(409);
    expect(full.codes).toEqual(["capacity_exhausted"]);
    const next = record(h, "2026-12-02");
    expect(
      refusal(() =>
        h.db.transaction((tx) => h.bookings.rescheduleIn(tx, operator(h), next.id, "2026-11-28")),
      ).codes,
    ).toEqual(["capacity_exhausted"]);
    expect(row(h, next.id).session_date).toBe("2026-12-02");
  });

  it("refuses a change to a booking that is no longer booked, and an unknown booking or offer", () => {
    const h = buildCatalogueHarness();
    const made = record(h, "2026-11-20");
    h.db.transaction((tx) => h.bookings.cancelIn(tx, operator(h), made.id));
    expect(
      refusal(() => h.db.transaction((tx) => h.bookings.holdIn(tx, operator(h), made.id))).codes,
    ).toEqual(["invalid_booking_state"]);
    expect(() => h.db.transaction((tx) => h.bookings.cancelIn(tx, operator(h), "missing"))).toThrow(
      HttpError,
    );
    expect(() =>
      h.db.transaction((tx) =>
        h.bookings.recordIn(tx, operator(h), "offer-99", { sessionDate: "2026-11-20" }),
      ),
    ).toThrow(HttpError);
  });

  it("rolls the booking and its audit back when the caller's transaction fails", () => {
    const h = buildCatalogueHarness();
    expect(() =>
      h.db.transaction((tx) => {
        h.bookings.recordIn(tx, operator(h), "offer-6", { sessionDate: "2026-11-20" });
        throw new Error("later step failed");
      }),
    ).toThrow("later step failed");
    expect(h.count("offer_session_booking")).toBe(0);
    expect(h.audit("offer.booking.record")).toHaveLength(0);
  });
});

describe("workshop-owned bookings through feature 005", () => {
  it.each([
    [
      "reschedule",
      (h: Harness, id: string) => h.bookings.reschedule(h.actor("lead"), id, "2026-11-26"),
    ],
    ["cancel", (h: Harness, id: string) => h.bookings.cancel(h.actor("lead"), id)],
    ["hold", (h: Harness, id: string) => h.bookings.markHeld(h.actor("lead"), id)],
    ["no_show", (h: Harness, id: string) => h.bookings.markNoShow(h.actor("lead"), id)],
  ] as const)("refuses to %s one, and audits the refusal", (op, act) => {
    const h = buildCatalogueHarness();
    const made = record(h, "2026-11-20");
    expect(() => act(h, made.id)).toThrow(/workshop/i);
    expect(row(h, made.id)).toMatchObject({ state: "booked", session_date: "2026-11-20" });
    const denied = h.audit(`offer.booking.${op}.refused`);
    expect(denied).toHaveLength(1);
    expect(denied[0]?.after_summary).toContain("booking_owned_by_workshop");
  });

  it("still changes a manual booking", () => {
    const h = buildCatalogueHarness();
    const manual = h.bookings.record(h.actor("lead"), "offer-6", { sessionDate: "2026-11-20" });
    expect(manual.source).toBe("manual");
    expect(h.bookings.cancel(h.actor("lead"), manual.id).state).toBe("cancelled");
  });
});
