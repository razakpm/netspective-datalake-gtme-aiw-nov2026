// Fixed organisation type list (spec FR-010) and the excluded set (FR-027, constitution VI).

export const ORG_TYPES = [
  "health_information_exchange",
  "state_medicaid_program_operator",
  "health_system",
  "medtech",
  "payer",
  "multi_site_practice",
  "biotech",
  "other",
  "unknown",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

/** Medtech is on hold; payers, multi-site practices and biotech are excluded. No silent broadening. */
export const EXCLUDED_ORG_TYPES: readonly OrgType[] = [
  "medtech",
  "payer",
  "multi_site_practice",
  "biotech",
];

export function isOrgType(value: string): value is OrgType {
  return (ORG_TYPES as readonly string[]).includes(value);
}

export function isExcludedOrgType(type: OrgType): boolean {
  return EXCLUDED_ORG_TYPES.includes(type);
}
