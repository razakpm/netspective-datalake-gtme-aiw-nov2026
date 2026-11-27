import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { buildWorkshopsHarness, type WorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T032 (quickstart V7 to V9, spec FR-007 to FR-009): one booked workshop takes one place
// in the period of its date; cancelling gives it back; a full offer refuses. The clock starts on Thursday
// 2026-11-19; Offer 6 has 3 per month and Offer 1 3 per week.
async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status, codes: error.codes ?? [], detail: error.message };
  }
  throw new Error("expected a refusal");
}
const make = async (h: WorkshopsHarness, offer: 1 | 6 = 6) =>
  h.workshops.convert(h.operator(), (await h.linkedIntake(offer)).requestId).id;
const move = (
  h: WorkshopsHarness,
  id: string,
  action: string,
  over: Record<string, unknown> = {},
) =>
  h.workshops.transition(h.operator(), id, {
    action,
    lockNo: h.workshops.get(h.operator(), id).lockNo,
    ...over,
  });
const book = (h: WorkshopsHarness, id: string, day: string, over: Record<string, unknown> = {}) =>
  move(h, id, "book", { scheduledAt: `${day}T10:00:00.000Z`, ...over });
const used = (h: WorkshopsHarness, offer: string, at = "2026-11-19T12:00:00.000Z") =>
  h.capacity.capacityStatus(offer, new Date(at)).used;
async function fill(h: WorkshopsHarness, days = ["2026-11-23", "2026-11-24", "2026-11-25"]) {
  const ids = [];
  for (const day of days) {
    const id = await make(h);
    await book(h, id, day);
    ids.push(id);
  }
  return ids;
}

describe("capacity", () => {
  it("takes exactly one place in the period of the session date, and answers with it", async () => {
    const h = buildWorkshopsHarness();
    const id = await make(h);
    expect(used(h, "offer-6")).toBe(0);
    const booked = await book(h, id, "2026-12-03");
    expect(used(h, "offer-6")).toBe(0);
    expect(used(h, "offer-6", "2026-12-15T12:00:00.000Z")).toBe(1);
    expect(booked.capacity).toMatchObject({ periodStart: "2026-12-01", used: 1, limit: 3 });
    const other = await make(h);
    // An unbooked workshop is answered for today.
    expect(h.workshops.get(h.operator(), other).capacity).toMatchObject({
      periodStart: "2026-11-01",
      used: 0,
    });
  });

  it("refuses a full offer, names the wait-list and leaves the workshop requested (V7)", async () => {
    const h = buildWorkshopsHarness();
    const [first] = await fill(h);
    const id = await make(h);
    const refused = await problem(() => book(h, id, "2026-11-27"));
    expect(refused).toMatchObject({ status: 409, codes: ["capacity_exhausted"] });
    expect(refused.detail).toContain("3 of 3");
    expect(refused.detail).toContain("wait-list");
    const read = h.workshops.get(h.operator(), id);
    expect(read).toMatchObject({ state: "requested", lockNo: 1 });
    expect(read.capacity).toMatchObject({ state: "exhausted", used: 3, remaining: 0 });
    expect(h.count("offer_session_booking")).toBe(3);
    expect(h.audit("workshop.book.refused")[0]?.after_summary).toContain("capacity_exhausted");
    expect(
      h.waitlist.add(h.operator(), "offer-6", {
        accountId: read.accountId,
        reason: "Offer 6 is full",
      }),
    ).toMatchObject({ offerId: "offer-6" });
    // Cancelling gives the place back at once.
    await move(h, first!, "cancel", { note: "buyer asked" });
    expect(used(h, "offer-6")).toBe(2);
    expect((await book(h, id, "2026-11-27")).state).toBe("booked");
  });

  it("keeps counting held and no-show sessions (V8)", async () => {
    const h = buildWorkshopsHarness();
    const [a, b, c] = await fill(h);
    await move(h, a!, "hold");
    await move(h, b!, "no_show", { note: "nobody joined" });
    expect(h.capacity.capacityStatus("offer-6", h.now())).toMatchObject({ used: 3, held: 1 });
    await move(h, c!, "cancel", { note: "buyer asked" });
    expect(used(h, "offer-6")).toBe(2);
  });

  it("moves the place on a reschedule, and refuses a full period without changing anything", async () => {
    const h = buildWorkshopsHarness();
    await fill(h);
    const december = await make(h);
    await book(h, december, "2026-12-02");
    const refused = await problem(() =>
      move(h, december, "reschedule", {
        scheduledAt: "2026-11-26T10:00:00.000Z",
        note: "buyer asked",
      }),
    );
    expect(refused).toMatchObject({ status: 409, codes: ["capacity_exhausted"] });
    expect(refused.detail).toContain("wait-list");
    expect(h.workshops.get(h.operator(), december)).toMatchObject({
      state: "booked",
      scheduledAt: "2026-12-02T10:00:00.000Z",
      lockNo: 2,
    });
    await move(h, december, "reschedule", {
      scheduledAt: "2027-01-05T10:00:00.000Z",
      note: "buyer asked",
    });
    expect(used(h, "offer-6", "2026-12-15T12:00:00.000Z")).toBe(0);
    expect(used(h, "offer-6", "2027-01-15T12:00:00.000Z")).toBe(1);
  });

  it("lets only one of two workshops take the last place, also through the calendar", async () => {
    const h = buildWorkshopsHarness();
    await fill(h, ["2026-11-23", "2026-11-24"]);
    const ids = [await make(h), await make(h)];
    const results = await Promise.allSettled([
      book(h, ids[0]!, "2026-11-26", { via: "calendar" }),
      book(h, ids[1]!, "2026-11-27", { via: "calendar" }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(used(h, "offer-6")).toBe(3);
    // The event made for the refused booking is removed again.
    expect(h.calendar.events.size).toBe(1);
  });

  it("books an offer with no limit and never calls it unlimited (V9)", async () => {
    const h = buildWorkshopsHarness();
    h.db.raw.exec("DROP TRIGGER offer_capacity_no_delete; DELETE FROM offer_capacity;");
    const id = await make(h);
    const booked = await book(h, id, "2026-11-23");
    expect(booked.capacity).toMatchObject({ state: "no_limit_set", limit: null, remaining: null });
    expect(JSON.stringify(booked.capacity)).not.toMatch(/unlimited/i);
  });
});
