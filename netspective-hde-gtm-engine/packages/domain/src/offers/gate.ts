import {
  REQUIRED_OFFER_FIELDS,
  type OfferSnapshot,
  type OfferStatus,
  type PublicOfferField,
  type RequiredOfferField,
} from "./types.js";

// The gate on moving an offer version to approved or available (feature 005, research R-04). Pure: it
// receives the snapshot, the limitation state and the checker's flags, and returns refusal codes.

export interface GateInput {
  to: OfferStatus;
  snapshot: OfferSnapshot;
  /** `acknowledged` means a valid acknowledgement: its wording hash equals the current wording's hash. */
  limitations: readonly { key: string; active: boolean; acknowledged: boolean }[];
  /** One entry per restricted phrase the checker found in a public field. */
  flags: readonly { field: PublicOfferField; rule: string; class: string; covered: boolean }[];
}

export type GateRefusal =
  | { code: "placeholder_attributes"; fields: RequiredOfferField[] }
  | { code: "limitation_unacknowledged"; limitations: string[] }
  | { code: "uncovered_restricted_phrase"; flags: { field: PublicOfferField; rule: string }[] };

const blank = (v: string | null) => v === null || v.trim() === "";
const emptyList = (v: string[] | null) => v === null || v.length === 0;

/** Required attributes that are still "to be provided" (null, blank or an empty list). */
export function missingRequiredFields(s: OfferSnapshot): RequiredOfferField[] {
  const missing: Record<RequiredOfferField, boolean> = {
    name: blank(s.name),
    format: blank(s.format),
    targetIcp: blank(s.targetIcp),
    buyerOutput: blank(s.buyerOutput),
    buyerEffort: blank(s.buyerEffort),
    effortEstimate: blank(s.effortEstimate.text),
    conversionPath: blank(s.conversionPath),
    landingPagePromise: blank(s.landingPagePromise),
    cta: blank(s.cta),
    intakeFields: emptyList(s.intakeFields),
    successHypotheses: emptyList(s.successHypotheses),
    sqlRuleRef: blank(s.sqlRuleRef),
  };
  return REQUIRED_OFFER_FIELDS.filter((f) => missing[f]);
}

export function evaluateOfferGate(input: GateInput): GateRefusal[] {
  if (input.to !== "approved" && input.to !== "available") return [];
  const refusals: GateRefusal[] = [];
  const fields = missingRequiredFields(input.snapshot);
  if (fields.length > 0) refusals.push({ code: "placeholder_attributes", fields });
  const unacknowledged = input.limitations
    .filter((l) => l.active && !l.acknowledged)
    .map((l) => l.key);
  if (unacknowledged.length > 0) {
    refusals.push({ code: "limitation_unacknowledged", limitations: unacknowledged });
  }
  const uncovered = input.flags
    .filter((f) => !f.covered)
    .map((f) => ({ field: f.field, rule: f.rule }));
  if (uncovered.length > 0)
    refusals.push({ code: "uncovered_restricted_phrase", flags: uncovered });
  return refusals;
}
