import { describe, expect, it } from "vitest";
import { OFFER_STATUSES, checkOfferTransition, type OfferStatus } from "../../src/index.js";

// Task T027: the pure offer status machine (spec FR-010). Order is draft -> internally_reviewed ->
// approved -> available; any live status can be withdrawn; approved or available can expire; nothing
// leaves withdrawn or expired.
const ALLOWED: [OfferStatus, OfferStatus][] = [
  ["draft", "internally_reviewed"],
  ["internally_reviewed", "approved"],
  ["approved", "available"],
  ["draft", "withdrawn"],
  ["internally_reviewed", "withdrawn"],
  ["approved", "withdrawn"],
  ["available", "withdrawn"],
  ["approved", "expired"],
  ["available", "expired"],
];

describe("offer status machine", () => {
  it.each(ALLOWED)("allows %s -> %s", (from, to) => {
    expect(checkOfferTransition(from, to)).toEqual({ ok: true });
  });

  it("refuses every other pair with invalid_transition and a plain reason", () => {
    for (const from of OFFER_STATUSES) {
      for (const to of OFFER_STATUSES) {
        if (ALLOWED.some(([f, t]) => f === from && t === to)) continue;
        const result = checkOfferTransition(from, to);
        expect(result.ok, `${from} -> ${to}`).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe("invalid_transition");
          expect(result.reason.length).toBeGreaterThan(10);
          expect(result.reason).toContain(from.replace("_", " "));
        }
      }
    }
  });

  it("refuses draft straight to available and names the next step", () => {
    const r = checkOfferTransition("draft", "available");
    expect(r).toMatchObject({ ok: false, code: "invalid_transition" });
    expect(r.ok ? "" : r.reason).toMatch(/internally reviewed/);
  });

  it("allows no move out of withdrawn or expired", () => {
    for (const from of ["withdrawn", "expired"] as const) {
      for (const to of OFFER_STATUSES) expect(checkOfferTransition(from, to).ok).toBe(false);
    }
  });

  it("refuses a move to the same status", () => {
    for (const s of OFFER_STATUSES) expect(checkOfferTransition(s, s).ok).toBe(false);
  });
});
