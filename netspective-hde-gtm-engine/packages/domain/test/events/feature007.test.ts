import { describe, expect, it } from "vitest";
import { FEATURE007_EVENT_PAYLOADS } from "../../src/index.js";

// Task T011: strict identifier-only payloads for feature 007.
const P = FEATURE007_EVENT_PAYLOADS;
const valid = {
  "workshop.requested": { workshop_id: "w1", offer_id: "offer-1", request_id: "q1" },
  "workshop.booked": { workshop_id: "w1", offer_id: "offer-1", reschedule: false },
  "workshop.held": { workshop_id: "w1", offer_id: "offer-1" },
  "workshop.findings_recorded": {
    workshop_id: "w1",
    offer_id: "offer-6",
    version_no: 1,
    waived: true,
  },
} as const;
const types = Object.keys(valid) as (keyof typeof valid)[];

describe("feature 007 event payloads", () => {
  it("registers the four event types", () => {
    expect(Object.keys(P).sort()).toEqual([...types].sort());
  });

  it.each(types)("%s accepts identifiers only", (type) => {
    expect(P[type].parse(valid[type])).toEqual(valid[type]);
  });

  it.each(types)("%s rejects names, notes, findings, text, links and dates", (type) => {
    for (const extra of [
      "name",
      "note",
      "finding",
      "findings",
      "title",
      "text",
      "link",
      "date",
      "scheduled_at",
      "email",
    ]) {
      expect(P[type].safeParse({ ...valid[type], [extra]: "something" }).success).toBe(false);
    }
  });

  it("rejects missing and malformed values", () => {
    for (const type of types) {
      expect(P[type].safeParse({ ...valid[type], workshop_id: "" }).success).toBe(false);
      expect(P[type].safeParse({}).success).toBe(false);
    }
    const booked = valid["workshop.booked"];
    expect(P["workshop.booked"].safeParse({ ...booked, reschedule: "no" }).success).toBe(false);
    const recorded = valid["workshop.findings_recorded"];
    for (const version_no of [0, 1.5, "1"]) {
      expect(P["workshop.findings_recorded"].safeParse({ ...recorded, version_no }).success).toBe(
        false,
      );
    }
  });
});
