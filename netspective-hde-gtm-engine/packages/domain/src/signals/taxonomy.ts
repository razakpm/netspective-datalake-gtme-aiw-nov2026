// Signal taxonomy definitions (spec FR-003, FR-004; research R-02). Pure data. The hypothesis seed types
// come from the spec Assumptions because source section 8.1 is not in the repository (open question #35).
// Every default here is a HYPOTHESIS, configurable by publishing a new taxonomy version.

export const SIGNAL_CATEGORIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I"] as const;
export type SignalCategory = (typeof SIGNAL_CATEGORIES)[number];

export const CATEGORY_LABELS: Readonly<Record<SignalCategory, string>> = {
  A: "Organisation and program",
  B: "Interoperability",
  C: "Operational data quality",
  D: "Data platform and architecture",
  E: "Procurement and funding",
  F: "Hiring and capability gap",
  G: "Executive and stakeholder change",
  H: "Regulatory and ecosystem context",
  I: "First-party Netspective",
};

export const SIGNAL_KINDS = ["general", "funding", "regulatory", "first_party"] as const;
export type SignalKind = (typeof SIGNAL_KINDS)[number];

export const RELIABILITIES = ["high", "medium", "low", "unknown"] as const;
export type Reliability = (typeof RELIABILITIES)[number];

export interface SignalTypeDefinition {
  key: string;
  category: SignalCategory;
  label: string;
  kind: SignalKind;
  defaultFreshnessDays: number;
  defaultReliability: Reliability;
  contextOnly: boolean;
}

/** Per-category freshness windows in days (hypothesis; open question #36). */
export const CATEGORY_FRESHNESS_DAYS: Readonly<Record<SignalCategory, number>> = {
  A: 365,
  B: 180,
  C: 180,
  D: 365,
  E: 120,
  F: 90,
  G: 180,
  H: 365,
  I: 90,
};

const t = (
  key: string,
  category: SignalCategory,
  label: string,
  defaultReliability: Reliability,
  kind: SignalKind = "general",
): SignalTypeDefinition => ({
  key,
  category,
  label,
  kind,
  defaultFreshnessDays: CATEGORY_FRESHNESS_DAYS[category],
  defaultReliability,
  contextOnly: kind === "regulatory",
});

export const SEED_SIGNAL_TYPES: readonly SignalTypeDefinition[] = [
  t("org_profile_fact", "A", "Organisation profile fact", "medium"),
  t("program_announcement", "A", "Program announcement", "medium"),
  t("multi_format_sender", "B", "Multi-format sender observed", "medium"),
  t("implementation_guide_change", "B", "Implementation-guide change", "medium"),
  t("onboarding_delay", "B", "Onboarding delay", "medium"),
  t("data_quality_issue", "C", "Data quality issue", "medium"),
  t("rejection_volume", "C", "Rejection volume", "medium"),
  t("platform_architecture_change", "D", "Platform or architecture change", "medium"),
  t("procurement_notice", "E", "Procurement notice (RFP)", "high"),
  t("grant_funding_announcement", "E", "Grant or funding announcement", "medium", "funding"),
  t("budget_approval_statement", "E", "Budget-approval statement", "high", "funding"),
  t("capability_gap_hiring", "F", "Capability-gap hiring", "low"),
  t("executive_change", "G", "Executive or stakeholder change", "medium"),
  t("regulatory_ecosystem_item", "H", "Regulatory or ecosystem item", "high", "regulatory"),
  t("lead_magnet_download", "I", "Lead-magnet download", "high", "first_party"),
  t("form_submission", "I", "Form submission", "high", "first_party"),
  t("workshop_meeting_note", "I", "Workshop or meeting note", "high", "first_party"),
];

/** Source kinds and the reliability each defaults to (hypothesis; clarified scale in FR-010). */
export const SOURCE_KINDS = [
  "official_publication",
  "buyer_statement",
  "third_party",
  "analyst_observation",
  "provider",
  "first_party",
  "other",
] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_KIND_RELIABILITY: Readonly<Record<SourceKind, Reliability>> = {
  official_publication: "high",
  buyer_statement: "high",
  third_party: "medium",
  analyst_observation: "medium",
  provider: "medium",
  first_party: "high",
  other: "low",
};

/** Plain-language definitions shown wherever the values appear (FR-010). */
export const RELIABILITY_DEFINITIONS: Readonly<Record<Reliability, string>> = {
  high: "An official publication or a buyer's own statement.",
  medium: "A reputable third party or an analyst's direct observation.",
  low: "Unattributed, secondary or inferred.",
  unknown: "Not rated (never read as low or high).",
};
export const CONFIDENCE_DEFINITIONS = {
  low: "Weak extraction: the source was ambiguous or the text was inferred.",
  medium: "Reasonable extraction: the source supports the observation with minor interpretation.",
  high: "Strong extraction: the source states the observation directly.",
} as const;
