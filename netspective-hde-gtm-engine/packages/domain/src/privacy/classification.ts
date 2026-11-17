// Data classification framework (spec FR-015). Every stored field or content type declares exactly one.
// `prohibited` covers PHI, patient-level data and credentials: it can never be stored, logged or sent
// to a provider or language model (constitution Principle IV).
export const DATA_CLASSIFICATIONS = [
  "public",
  "business_contact",
  "confidential_commercial",
  "internal_case_study_restricted",
  "sensitive_operational_metadata",
  "prohibited",
] as const;

export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

export function isDataClassification(value: unknown): value is DataClassification {
  return typeof value === "string" && (DATA_CLASSIFICATIONS as readonly string[]).includes(value);
}

export function isProhibitedClassification(classification: DataClassification): boolean {
  return classification === "prohibited";
}
