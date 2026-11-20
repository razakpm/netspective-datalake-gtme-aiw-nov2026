import { describe, expect, it } from "vitest";
import { FEATURE005_EVENT_PAYLOADS } from "../../src/index.js";

// Task T012: strict identifier-only payloads for feature 005.
const P = FEATURE005_EVENT_PAYLOADS;
const valid = {
  "capability.updated": { capability_id: "capability-01", change: "edit" },
  "offer.updated": { offer_id: "offer-7", version_no: 2, change: "status", status: "approved" },
  "offer.capacity.changed": { offer_id: "offer-6", period_kind: "month", limit_sessions: 3 },
  "claim.created": { claim_id: "c1", effective_class: "ai_ready" },
  "claim.reviewed": { claim_id: "c1", decision: "approve", claim_status: "in_review" },
  "claim.needs_review": { claim_id: "c1" },
} as const;

describe("feature 005 event payloads", () => {
  it("registers the six event types", () => {
    expect(Object.keys(P).sort()).toEqual(Object.keys(valid).sort());
  });

  it.each(Object.keys(valid) as (keyof typeof valid)[])("%s accepts identifiers only", (type) => {
    expect(P[type].parse(valid[type])).toEqual(valid[type]);
  });

  it.each(Object.keys(valid) as (keyof typeof valid)[])(
    "%s rejects an extra field, so a text field cannot slip in",
    (type) => {
      for (const extra of ["text", "note", "wording", "statement", "example"]) {
        expect(P[type].safeParse({ ...valid[type], [extra]: "some text" }).success).toBe(false);
      }
    },
  );

  it("rejects unknown values and missing identifiers", () => {
    expect(
      P["capability.updated"].safeParse({ ...valid["capability.updated"], change: "x" }).success,
    ).toBe(false);
    expect(
      P["offer.updated"].safeParse({ ...valid["offer.updated"], change: "text" }).success,
    ).toBe(false);
    expect(
      P["offer.updated"].safeParse({ ...valid["offer.updated"], status: "superseded" }).success,
    ).toBe(false);
    expect(P["offer.updated"].safeParse({ ...valid["offer.updated"], version_no: 0 }).success).toBe(
      false,
    );
    expect(
      P["offer.capacity.changed"].safeParse({
        ...valid["offer.capacity.changed"],
        period_kind: "day",
      }).success,
    ).toBe(false);
    expect(
      P["offer.capacity.changed"].safeParse({
        ...valid["offer.capacity.changed"],
        limit_sessions: -1,
      }).success,
    ).toBe(false);
    expect(
      P["claim.created"].safeParse({ ...valid["claim.created"], effective_class: "x" }).success,
    ).toBe(false);
    expect(
      P["claim.reviewed"].safeParse({ ...valid["claim.reviewed"], decision: "withdraw" }).success,
    ).toBe(false);
    expect(
      P["claim.reviewed"].safeParse({ ...valid["claim.reviewed"], claim_status: "needs_review" })
        .success,
    ).toBe(false);
    expect(P["claim.needs_review"].safeParse({}).success).toBe(false);
    expect(P["claim.needs_review"].safeParse({ claim_id: "" }).success).toBe(false);
  });
});
