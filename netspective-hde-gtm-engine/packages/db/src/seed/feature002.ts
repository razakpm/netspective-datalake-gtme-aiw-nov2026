import type { Tx } from "../sqlite/database.js";

// Feature 002 reference data (task T011): the 20 fixed stakeholder roles and the configurable lists.
// Idempotent. Values marked hypothesis are confirmed with the GTM lead / privacy lead (open question #29).

export const STAKEHOLDER_ROLES: readonly [string, string][] = [
  ["operational_user", "Operational user"],
  ["onboarding_data_quality_lead", "Onboarding / data-quality lead"],
  ["integration_lead", "Integration lead"],
  ["data_engineering_lead", "Data engineering lead"],
  ["interoperability_director", "Interoperability director"],
  ["data_operations_director", "Data operations director"],
  ["data_governance_lead", "Data governance lead"],
  ["privacy_compliance_lead", "Privacy / compliance lead"],
  ["cmio", "CMIO"],
  ["cdo", "CDO"],
  ["ai_governance_lead", "AI governance lead"],
  ["cio", "CIO"],
  ["cfo", "CFO"],
  ["executive_director", "Executive director"],
  ["state_program_director", "State program director"],
  ["procurement_contact", "Procurement contact"],
  ["economic_buyer", "Economic buyer"],
  ["champion", "Champion"],
  ["technical_evaluator", "Technical evaluator"],
  ["unknown", "Unknown"],
];

const CONTACT_SOURCES: readonly [string, string][] = [
  ["manual_import", "Manual import with a documented origin"],
  ["first_party_form", "First-party form submission"],
  ["public_directory", "Public business directory or organisation website"],
  ["referral", "Referral or introduction"],
  ["customer_supplied_list", "Customer-supplied list"],
];

const PERMITTED_BASES: readonly [string, string][] = [
  ["b2b_legitimate_interest", "Business-to-business legitimate interest"],
  ["consent", "Consent given"],
  ["existing_relationship", "Existing relationship"],
  ["service_related", "Service-related"],
];

const PERSONAL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "ymail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "aol.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "zoho.com",
  "yandex.com",
];

export function seedFeature002(tx: Tx): void {
  const role = tx.prepare(
    "INSERT INTO stakeholder_role (key, label, sort) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET label = excluded.label, sort = excluded.sort",
  );
  STAKEHOLDER_ROLES.forEach(([key, label], i) => role.run(key, label, i + 1));

  const list = tx.prepare("INSERT OR IGNORE INTO config_list (list, value, label) VALUES (?,?,?)");
  for (const [v, l] of CONTACT_SOURCES) list.run("contact_source", v, l);
  for (const [v, l] of PERMITTED_BASES) list.run("permitted_basis", v, l);
  for (const d of PERSONAL_DOMAINS) list.run("personal_domain", d, d);
}
