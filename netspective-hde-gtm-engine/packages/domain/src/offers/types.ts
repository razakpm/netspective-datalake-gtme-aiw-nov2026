// Offer content as stored in an immutable version (feature 005, research R-03). Every content field is
// nullable: null means "to be provided" and is never replaced by invented text (open question #47).

export const OFFER_STATUSES = [
  "draft",
  "internally_reviewed",
  "approved",
  "available",
  "withdrawn",
  "expired",
] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export interface OfferSnapshot {
  name: string | null;
  format: string | null;
  targetIcp: string | null;
  buyerOutput: string | null;
  buyerEffort: string | null;
  /** The Netspective effort estimate. It is always a hypothesis (FR-015). */
  effortEstimate: { text: string | null; status: "hypothesis" };
  conversionPath: string | null;
  landingPagePromise: string | null;
  cta: string | null;
  intakeFields: string[] | null;
  successHypotheses: string[] | null;
  /** Identifier of the qualification rule; the rule itself is owned by qualification (FR-016). */
  sqlRuleRef: string | null;
  relatedCapabilityKeys: string[];
  paidTypeKey: string | null;
}

/** A snapshot with every content attribute still to be provided. */
export function blankSnapshot(): OfferSnapshot {
  return {
    name: null,
    format: null,
    targetIcp: null,
    buyerOutput: null,
    buyerEffort: null,
    effortEstimate: { text: null, status: "hypothesis" },
    conversionPath: null,
    landingPagePromise: null,
    cta: null,
    intakeFields: null,
    successHypotheses: null,
    sqlRuleRef: null,
    relatedCapabilityKeys: [],
    paidTypeKey: null,
  };
}

/** Attributes that must be present before a version may be approved or made available (FR-012). */
export const REQUIRED_OFFER_FIELDS = [
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
] as const;
export type RequiredOfferField = (typeof REQUIRED_OFFER_FIELDS)[number];

/** Public fields: text a buyer may see, and so subject to the claim checker (research R-04). */
export const PUBLIC_OFFER_FIELDS = [
  "landingPagePromise",
  "cta",
  "buyerOutput",
  "conversionPath",
] as const;
export type PublicOfferField = (typeof PUBLIC_OFFER_FIELDS)[number];
