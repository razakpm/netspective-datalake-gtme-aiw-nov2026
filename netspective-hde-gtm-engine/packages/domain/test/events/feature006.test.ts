import { describe, expect, it } from "vitest";
import { FEATURE006_EVENT_PAYLOADS } from "../../src/index.js";

// Task T012: strict identifier-only payloads for feature 006.
const P = FEATURE006_EVENT_PAYLOADS;
const valid = {
  "offer.recommended": {
    recommendation_id: "r1",
    account_id: "a1",
    outcome: "offer",
    outreach: "allowed",
    rule_set_version: 1,
  },
  "offer.requested": { request_id: "q1", offer_id: "offer-5", kind: "download" },
  "lead_magnet.downloaded": { download_id: "d1", request_id: "q1", delivered: true },
} as const;

describe("feature 006 event payloads", () => {
  it("registers the three event types", () => {
    expect(Object.keys(P).sort()).toEqual(Object.keys(valid).sort());
  });

  it.each(Object.keys(valid) as (keyof typeof valid)[])("%s accepts identifiers only", (type) => {
    expect(P[type].parse(valid[type])).toEqual(valid[type]);
  });

  it.each(Object.keys(valid) as (keyof typeof valid)[])(
    "%s rejects an email, name, role, explanation, decision text or link",
    (type) => {
      for (const extra of ["email", "name", "role", "explanation", "decision", "link", "text"]) {
        expect(P[type].safeParse({ ...valid[type], [extra]: "something" }).success).toBe(false);
      }
    },
  );

  it("rejects unknown values", () => {
    expect(
      P["offer.recommended"].safeParse({ ...valid["offer.recommended"], outcome: "sale" }).success,
    ).toBe(false);
    expect(
      P["offer.recommended"].safeParse({ ...valid["offer.recommended"], outreach: "sent" }).success,
    ).toBe(false);
    expect(
      P["offer.recommended"].safeParse({ ...valid["offer.recommended"], rule_set_version: 0 })
        .success,
    ).toBe(false);
    expect(
      P["offer.requested"].safeParse({ ...valid["offer.requested"], kind: "purchase" }).success,
    ).toBe(false);
    expect(
      P["lead_magnet.downloaded"].safeParse({
        ...valid["lead_magnet.downloaded"],
        delivered: "yes",
      }).success,
    ).toBe(false);
  });
});
