import { describe, expect, it } from "vitest";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T039: the capacity status for one offer answers in under 200 ms with 1,000 bookings (plan, SC-005).
describe("capacity status performance", () => {
  it("answers in under 200 ms with 1,000 synthetic bookings", () => {
    const h = buildCatalogueHarness();
    const insert = h.db.raw.prepare(
      "INSERT INTO offer_session_booking (id, offer_id, external_ref, state, session_date, period_start, source, recorded_by, recorded_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    );
    h.db.raw.exec("BEGIN");
    for (let i = 0; i < 1000; i++) {
      const day = String(1 + (i % 28)).padStart(2, "0");
      const month = String(1 + (i % 12)).padStart(2, "0");
      insert.run(
        `b-${i}`,
        "offer-6",
        `r-${i}`,
        i % 5 === 0 ? "cancelled" : "booked",
        `2026-${month}-${day}`,
        `2026-${month}-01`,
        "workshop",
        "seed",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    }
    h.db.raw.exec("COMMIT");
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      h.capacity.capacityStatus("offer-6", h.now());
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(200);
  });
});
