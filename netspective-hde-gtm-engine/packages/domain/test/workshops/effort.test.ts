import { describe, expect, it } from "vitest";
import { EffortSchema, summariseEffort } from "../../src/index.js";

// Feature 007 task T059 (spec FR-033): effort ranges and the per-offer summary.
const ok = (v: unknown) => EffortSchema.safeParse(v).success;
const entry = (over: Record<string, unknown> = {}) => ({
  prepHours: 2.5,
  sessionHours: 1,
  people: 2,
  ...over,
});

describe("effort figures", () => {
  it("accepts figures inside the ranges", () => {
    for (const good of [
      entry(),
      entry({ prepHours: 0, sessionHours: 0, people: 1 }),
      entry({ prepHours: 80, sessionHours: 24, people: 20 }),
      entry({ prepHours: 0.25, sessionHours: 0.75 }),
    ]) {
      expect(ok(good), JSON.stringify(good)).toBe(true);
    }
  });
  it("refuses anything negative, absurd, off the quarter hour or not a number", () => {
    for (const bad of [
      { prepHours: -0.25 },
      { prepHours: 80.25 },
      { prepHours: 1.1 },
      { sessionHours: -1 },
      { sessionHours: 24.5 },
      { people: 0 },
      { people: 21 },
      { people: 1.5 },
      { prepHours: "2" },
      { people: undefined },
      { cost: 100 },
    ]) {
      expect(ok(entry(bad)), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("the summary", () => {
  const rows = [
    { state: "closed", effort: { prepHours: 2, sessionHours: 0.75, people: 1 } },
    { state: "held", effort: { prepHours: 3.5, sessionHours: 1, people: 2 } },
    { state: "held", effort: null },
    { state: "cancelled", effort: null },
  ] as const;
  it("gives totals and averages, and counts missing effort as missing, not zero", () => {
    expect(summariseEffort(rows)).toEqual({
      workshops: 3,
      withEffort: 2,
      missing: 1,
      totalPrepHours: 5.5,
      totalSessionHours: 1.75,
      averagePrepHours: 2.75,
      averageSessionHours: 0.88,
      averagePeople: 1.5,
    });
  });
  it("has no averages when nothing is recorded", () => {
    expect(summariseEffort([{ state: "held", effort: null }])).toMatchObject({
      workshops: 1,
      withEffort: 0,
      missing: 1,
      totalPrepHours: 0,
      averagePrepHours: null,
      averageSessionHours: null,
      averagePeople: null,
    });
    expect(summariseEffort([])).toMatchObject({ workshops: 0, missing: 0 });
  });
  it("keeps effort recorded on a cancelled workshop", () => {
    expect(
      summariseEffort([
        { state: "cancelled", effort: { prepHours: 1, sessionHours: 0, people: 1 } },
      ]),
    ).toMatchObject({ workshops: 1, withEffort: 1, missing: 0 });
  });
});
