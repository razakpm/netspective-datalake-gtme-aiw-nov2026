import { describe, expect, it } from "vitest";
import { HttpError } from "../src/http/errors.js";
import { buildWorkshopsHarness } from "../test-support/workshops-harness.js";

// Feature 007 task T059 (quickstart V28, spec FR-033, SC-010).
async function problem(fn: () => unknown) {
  try {
    await fn();
  } catch (error) {
    if (!(error instanceof HttpError)) throw error;
    return { status: error.status };
  }
  throw new Error("expected a refusal");
}
const figures = (prepHours: number, sessionHours: number, people: number) => ({
  prepHours,
  sessionHours,
  people,
});

describe("delivery effort", () => {
  it("keeps every entry, the latest counting", async () => {
    const h = buildWorkshopsHarness();
    const id = (await h.heldWorkshop(1)).id;
    expect(h.effort.get(h.reader(), id)).toEqual({ current: null, history: [] });
    h.effort.record(h.operator(), id, figures(2, 0.75, 1));
    h.advance(1000);
    const fixed = h.effort.record(h.operator(), id, figures(3, 0.75, 2));
    const read = h.effort.get(h.reader(), id);
    expect(read.current).toEqual(fixed);
    expect(read.history).toHaveLength(2);
    expect(h.audit("workshop.effort.record")).toHaveLength(2);
  });

  it("refuses figures outside the ranges and people without the permission", async () => {
    const h = buildWorkshopsHarness();
    const id = (await h.heldWorkshop(1)).id;
    for (const bad of [figures(-1, 1, 1), figures(1, 25, 1), figures(1, 1, 0)]) {
      expect(await problem(() => h.effort.record(h.operator(), id, bad))).toEqual({ status: 400 });
    }
    expect(await problem(() => h.effort.record(h.reader(), id, figures(1, 1, 1)))).toEqual({
      status: 403,
    });
    expect(await problem(() => h.effort.record(h.operator(), "missing", figures(1, 1, 1)))).toEqual(
      { status: 404 },
    );
    expect(h.count("delivery_effort")).toBe(0);
  });

  it("summarises each offer beside its estimate, with missing shown as missing", async () => {
    const h = buildWorkshopsHarness();
    const first = (await h.heldWorkshop(1)).id;
    const second = (await h.heldWorkshop(1)).id;
    await h.heldWorkshop(1);
    const cancelled = h.workshops.convert(h.operator(), (await h.linkedIntake(1)).requestId);
    await h.workshops.transition(h.operator(), cancelled.id, {
      action: "cancel",
      lockNo: 1,
      note: "buyer asked",
    });
    h.effort.record(h.operator(), first, figures(2, 0.75, 1));
    h.effort.record(h.operator(), second, figures(4, 1.25, 3));
    const summary = h.effort.summary(h.reader());
    expect(summary.map((s) => s.offerId)).toEqual(["offer-1", "offer-6"]);
    expect(summary[0]).toMatchObject({
      offerKey: "sender-onboarding-friction-map",
      workshops: 3,
      withEffort: 2,
      missing: 1,
      totalPrepHours: 6,
      averagePrepHours: 3,
      averageSessionHours: 1,
      averagePeople: 2,
      status: "hypothesis",
    });
    expect(summary[0]).toHaveProperty("estimate");
    expect(summary[1]).toMatchObject({ workshops: 0, withEffort: 0, averagePrepHours: null });
  });
});
