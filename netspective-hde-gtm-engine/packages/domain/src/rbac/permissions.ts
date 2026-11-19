// Foundation roles and permissions (spec FR-004, FR-008). The role matrix is a hypothesis pending the
// GTM lead (open question #27); later features add their own permissions.

export const PERMISSIONS = [
  "users.manage",
  "audit.read",
  "jobs.read",
  "webhooks.read",
  "quarantine.review",
  "ai_invocations.read",
  "providers.manage",
  // Feature 002 (accounts, contacts, ICP). Role mapping is a hypothesis (open question #32).
  "accounts.read",
  "accounts.import",
  "accounts.edit",
  "contacts.read",
  "contacts.import",
  "contacts.edit",
  "contacts.erase",
  "stakeholders.edit",
  "evidence.record",
  "review.decide",
  "icp.read",
  "icp.assess",
  "icp.manage",
  "icp.override",
  "suppressions.lift",
  // Feature 003 (signals and evidence). Role mapping is a hypothesis (open question #38).
  "signals.read",
  "signals.record",
  "signals.review",
  "signals.sources.manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_KEYS = [
  "gtm_operator",
  "research_analyst",
  "technical_sme_reviewer",
  "sales_service_lead",
  "campaign_approver",
  "administrator",
  "read_only_executive",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const READERS = ["accounts.read", "contacts.read", "icp.read", "signals.read"] as const;

export const FOUNDATION_ROLE_PERMISSIONS: Readonly<Record<RoleKey, readonly Permission[]>> = {
  gtm_operator: [
    "jobs.read",
    "webhooks.read",
    ...READERS,
    "accounts.import",
    "accounts.edit",
    "contacts.import",
    "contacts.edit",
    "review.decide",
    "stakeholders.edit",
    "evidence.record",
    "icp.assess",
    "signals.record",
  ],
  research_analyst: [...READERS, "icp.assess", "signals.record"],
  technical_sme_reviewer: [...READERS, "signals.review"],
  sales_service_lead: [...READERS, "stakeholders.edit", "evidence.record"],
  campaign_approver: [],
  administrator: [...PERMISSIONS],
  read_only_executive: ["audit.read", "jobs.read", "ai_invocations.read", ...READERS],
};

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Permissions that only a human may hold: user management, quarantine review and any approval. */
export function isRestrictedPermission(key: string): boolean {
  return (
    key === "users.manage" ||
    key === "quarantine.review" ||
    key.endsWith(".approve") ||
    key === "icp.manage" ||
    key === "icp.override" ||
    key === "suppressions.lift" ||
    key === "contacts.erase" ||
    key === "signals.review"
  );
}

/** Roles that carry approval or administrative authority even before they hold permissions. */
export const RESTRICTED_ROLE_KEYS: readonly string[] = [
  "administrator",
  "campaign_approver",
  "technical_sme_reviewer",
];
