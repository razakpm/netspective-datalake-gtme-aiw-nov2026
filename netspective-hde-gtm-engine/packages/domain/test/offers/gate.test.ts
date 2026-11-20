import { describe, expect, it } from "vitest";
import {
  blankSnapshot,
  evaluateOfferGate,
  missingRequiredFields,
  OfferSnapshotSchema,
  type GateInput,
  type OfferSnapshot,
} from "../../src/index.js";

// Task T028: the pure gate on moving a version to approved or available (research R-04, FR-012, FR-013,
// FR-014). Refusals come back together in a stable order.
const complete = (): OfferSnapshot => ({
  name: "Offer",
  format: "45-minute session, no PHI",
  targetIcp: "ICP1",
  buyerOutput: "A friction map",
  buyerEffort: "One hour",
  effortEstimate: { text: "About two days", status: "hypothesis" },
  conversionPath: "Book a session",
  landingPagePromise: "See where senders stall",
  cta: "Book now",
  intakeFields: ["Organisation", "Sender count"],
  successHypotheses: ["Senders stall at onboarding"],
  sqlRuleRef: "sql-offer-1",
  relatedCapabilityKeys: [],
  paidTypeKey: null,
});
const input = (over: Partial<GateInput> = {}): GateInput => ({
  to: "approved",
  snapshot: complete(),
  limitations: [],
  flags: [],
  ...over,
});
const codes = (i: GateInput) => evaluateOfferGate(i).map((r) => r.code);

describe("placeholder attributes", () => {
  it("passes a complete snapshot", () => {
    expect(evaluateOfferGate(input())).toEqual([]);
    expect(evaluateOfferGate(input({ to: "available" }))).toEqual([]);
  });

  it("refuses a blank snapshot and lists every missing field", () => {
    const r = evaluateOfferGate(input({ snapshot: blankSnapshot() }));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ code: "placeholder_attributes" });
    expect(r[0]?.code === "placeholder_attributes" && r[0].fields).toEqual([
      "name",
      "format",
      "targetIcp",
      "buyerOutput",
      "buyerEffort",
      "effortEstimate",
      "conversionPath",
      "landingPagePromise",
      "cta",
      "intakeFields",
      "successHypotheses",
      "sqlRuleRef",
    ]);
  });

  it("treats null, empty text, blank text and empty lists as missing", () => {
    expect(missingRequiredFields({ ...complete(), name: null })).toEqual(["name"]);
    expect(missingRequiredFields({ ...complete(), name: "" })).toEqual(["name"]);
    expect(missingRequiredFields({ ...complete(), name: "   " })).toEqual(["name"]);
    expect(missingRequiredFields({ ...complete(), intakeFields: [] })).toEqual(["intakeFields"]);
    expect(missingRequiredFields({ ...complete(), successHypotheses: null })).toEqual([
      "successHypotheses",
    ]);
    expect(
      missingRequiredFields({
        ...complete(),
        effortEstimate: { text: null, status: "hypothesis" },
      }),
    ).toEqual(["effortEstimate"]);
  });

  it("does not require related capabilities or a paid engagement type", () => {
    expect(
      missingRequiredFields({ ...complete(), relatedCapabilityKeys: [], paidTypeKey: null }),
    ).toEqual([]);
  });
});

describe("limitations", () => {
  it("refuses an active limitation without a valid acknowledgement", () => {
    const r = evaluateOfferGate(
      input({
        limitations: [
          { key: "evaluation_is_buyer_prompt_only", active: true, acknowledged: false },
        ],
      }),
    );
    expect(r).toEqual([
      { code: "limitation_unacknowledged", limitations: ["evaluation_is_buyer_prompt_only"] },
    ]);
  });
  it("passes when acknowledged, and ignores an inactive limitation", () => {
    expect(
      evaluateOfferGate(input({ limitations: [{ key: "a", active: true, acknowledged: true }] })),
    ).toEqual([]);
    expect(
      evaluateOfferGate(input({ limitations: [{ key: "a", active: false, acknowledged: false }] })),
    ).toEqual([]);
  });
});

describe("restricted phrases in public fields", () => {
  it("refuses an uncovered flag and names the field and rule, never the text", () => {
    const r = evaluateOfferGate(
      input({
        flags: [
          { field: "landingPagePromise", rule: "soc2", class: "certification", covered: false },
        ],
      }),
    );
    expect(r).toEqual([
      {
        code: "uncovered_restricted_phrase",
        flags: [{ field: "landingPagePromise", rule: "soc2" }],
      },
    ]);
  });
  it("passes a covered flag", () => {
    expect(
      evaluateOfferGate(
        input({ flags: [{ field: "cta", rule: "sla", class: "sla_rto", covered: true }] }),
      ),
    ).toEqual([]);
  });
});

describe("combination and scope", () => {
  it("returns all refusals together in a stable order", () => {
    expect(
      codes(
        input({
          snapshot: blankSnapshot(),
          limitations: [{ key: "a", active: true, acknowledged: false }],
          flags: [{ field: "cta", rule: "sla", class: "sla_rto", covered: false }],
        }),
      ),
    ).toEqual([
      "placeholder_attributes",
      "limitation_unacknowledged",
      "uncovered_restricted_phrase",
    ]);
  });

  it("applies only when moving to approved or available", () => {
    const bad = input({
      snapshot: blankSnapshot(),
      limitations: [{ key: "a", active: true, acknowledged: false }],
      flags: [{ field: "cta", rule: "sla", class: "sla_rto", covered: false }],
    });
    for (const to of ["draft", "internally_reviewed", "withdrawn", "expired"] as const) {
      expect(evaluateOfferGate({ ...bad, to })).toEqual([]);
    }
  });
});

describe("snapshot schema", () => {
  it("always carries the effort estimate as a hypothesis", () => {
    expect(OfferSnapshotSchema.safeParse(complete()).success).toBe(true);
    expect(
      OfferSnapshotSchema.safeParse({
        ...complete(),
        effortEstimate: { text: "x", status: "confirmed" },
      }).success,
    ).toBe(false);
    expect(blankSnapshot().effortEstimate.status).toBe("hypothesis");
  });
  it("rejects unknown keys and over-long fields", () => {
    expect(OfferSnapshotSchema.safeParse({ ...complete(), price: "1" }).success).toBe(false);
    expect(OfferSnapshotSchema.safeParse({ ...complete(), name: "x".repeat(121) }).success).toBe(
      false,
    );
    expect(OfferSnapshotSchema.safeParse({ ...complete(), sqlRuleRef: "" }).success).toBe(false);
    expect(
      OfferSnapshotSchema.safeParse({ ...complete(), sqlRuleRef: "x".repeat(101) }).success,
    ).toBe(false);
  });
});
