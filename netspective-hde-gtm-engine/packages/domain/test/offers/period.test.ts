import { describe, expect, it } from "vitest";
import { localDateOf, periodFor, periodForLocalDate } from "../../src/index.js";

// Task T036: calendar weeks (Monday to Sunday) and calendar months in the business time zone (FR-017).
// A period is [start, end): both are local dates, end exclusive.
const at = (iso: string) => new Date(iso);

describe("localDateOf", () => {
  it("is the calendar date in the zone", () => {
    expect(localDateOf(at("2026-11-30T23:30:00Z"), "UTC")).toBe("2026-11-30");
    expect(localDateOf(at("2026-12-01T04:30:00Z"), "America/New_York")).toBe("2026-11-30");
    expect(localDateOf(at("2026-12-01T05:00:00Z"), "America/New_York")).toBe("2026-12-01");
    expect(localDateOf(at("2026-11-30T15:00:00Z"), "Asia/Tokyo")).toBe("2026-12-01");
  });
  it("rejects an unknown zone", () => {
    expect(() => localDateOf(at("2026-11-30T00:00:00Z"), "Mars/Olympus")).toThrow(RangeError);
  });
});

describe("month periods", () => {
  it("run from the first day to the first day of the next month", () => {
    expect(periodFor(at("2026-11-19T10:00:00Z"), "month", "UTC")).toEqual({
      kind: "month",
      start: "2026-11-01",
      end: "2026-12-01",
    });
  });
  it("handle the last and first day, February and the year end", () => {
    expect(periodFor(at("2026-11-30T23:59:59Z"), "month", "UTC").start).toBe("2026-11-01");
    expect(periodFor(at("2026-12-01T00:00:00Z"), "month", "UTC").start).toBe("2026-12-01");
    expect(periodForLocalDate("2028-02-29", "month")).toEqual({
      kind: "month",
      start: "2028-02-01",
      end: "2028-03-01",
    });
    expect(periodForLocalDate("2026-12-31", "month")).toEqual({
      kind: "month",
      start: "2026-12-01",
      end: "2027-01-01",
    });
  });
  it("use the business time zone for the boundary", () => {
    expect(periodFor(at("2026-12-01T04:30:00Z"), "month", "America/New_York").start).toBe(
      "2026-11-01",
    );
    expect(periodFor(at("2026-12-01T05:00:00Z"), "month", "America/New_York").start).toBe(
      "2026-12-01",
    );
    expect(periodFor(at("2026-11-30T15:00:00Z"), "month", "Asia/Tokyo").start).toBe("2026-12-01");
  });
});

describe("week periods", () => {
  it("run Monday to Sunday", () => {
    // 2026-11-19 is a Thursday.
    expect(periodFor(at("2026-11-19T10:00:00Z"), "week", "UTC")).toEqual({
      kind: "week",
      start: "2026-11-16",
      end: "2026-11-23",
    });
  });
  it("put Sunday in the week that began the Monday before and Monday in the next", () => {
    expect(periodForLocalDate("2026-11-22", "week").start).toBe("2026-11-16");
    expect(periodForLocalDate("2026-11-23", "week").start).toBe("2026-11-23");
    expect(periodForLocalDate("2026-11-16", "week").start).toBe("2026-11-16");
  });
  it("cross month and year boundaries", () => {
    expect(periodForLocalDate("2026-12-02", "week")).toEqual({
      kind: "week",
      start: "2026-11-30",
      end: "2026-12-07",
    });
    expect(periodForLocalDate("2027-01-01", "week")).toEqual({
      kind: "week",
      start: "2026-12-28",
      end: "2027-01-04",
    });
  });
  it("use the business time zone and survive daylight-saving changes", () => {
    // New York falls back on Sunday 2026-11-01 and springs forward on Sunday 2026-03-08.
    expect(periodFor(at("2026-11-01T04:30:00Z"), "week", "America/New_York").start).toBe(
      "2026-10-26",
    );
    expect(periodFor(at("2026-11-02T04:59:00Z"), "week", "America/New_York").start).toBe(
      "2026-10-26",
    );
    expect(periodFor(at("2026-11-02T05:00:00Z"), "week", "America/New_York").start).toBe(
      "2026-11-02",
    );
    expect(periodFor(at("2026-03-09T03:59:00Z"), "week", "America/New_York").start).toBe(
      "2026-03-02",
    );
    expect(periodFor(at("2026-03-09T04:00:00Z"), "week", "America/New_York").start).toBe(
      "2026-03-09",
    );
    expect(periodForLocalDate("2026-03-08", "week")).toEqual({
      kind: "week",
      start: "2026-03-02",
      end: "2026-03-09",
    });
  });
});

describe("local dates", () => {
  it("reject anything that is not a real calendar date", () => {
    for (const bad of ["2026-02-30", "2026-13-01", "26-01-01", "2026-1-1", "", "tomorrow"]) {
      expect(() => periodForLocalDate(bad, "month"), bad).toThrow(RangeError);
    }
  });
});
