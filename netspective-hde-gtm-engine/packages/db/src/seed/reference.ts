import {
  FOUNDATION_ROLE_PERMISSIONS,
  PERMISSIONS,
  ROLE_KEYS,
  type Permission,
  type RoleKey,
} from "@gtm/domain";
import type { Tx } from "../sqlite/database.js";
import { seedFeature002 } from "./feature002.js";
import { seedFeature003 } from "./feature003.js";

// Reference data seed (task T040): the seven roles, seven permissions and the foundation matrix.
// Idempotent, and run in every environment (it is not synthetic prospect data).

const ROLE_NAMES: Readonly<Record<RoleKey, string>> = {
  gtm_operator: "GTM operator",
  research_analyst: "Research analyst",
  technical_sme_reviewer: "Technical SME reviewer",
  sales_service_lead: "Sales and service lead",
  campaign_approver: "Campaign approver",
  administrator: "Administrator",
  read_only_executive: "Read-only executive",
};

const PERMISSION_DESCRIPTIONS: Readonly<Record<Permission, string>> = {
  "users.manage": "Invite, deactivate and assign roles to users",
  "audit.read": "Read the audit trail",
  "jobs.read": "View background jobs",
  "webhooks.read": "View received webhooks",
  "quarantine.review": "Review quarantined input",
  "ai_invocations.read": "View AI invocation records",
  "providers.manage": "Manage external provider settings",
  "accounts.read": "View accounts",
  "accounts.import": "Import organisations from CSV",
  "accounts.edit": "Edit accounts",
  "contacts.read": "View contacts and suppression state",
  "contacts.import": "Import contacts from CSV",
  "contacts.edit": "Edit contacts",
  "contacts.erase": "Erase a contact's personal details on request",
  "stakeholders.edit": "Edit stakeholder roles",
  "evidence.record": "Record evidence references",
  "review.decide": "Decide merge candidates and contact conflicts",
  "icp.read": "View ICP definitions and fit assessments",
  "icp.assess": "Run ICP fit assessments",
  "icp.manage": "Create and activate ICP definition versions",
  "icp.override": "Grant or revoke exclusion overrides",
  "suppressions.lift": "Lift a suppression",
  "signals.read": "View signals and evidence",
  "signals.record": "Record signals",
  "signals.review": "Approve, reject, mark contradictory and re-verify signals",
  "signals.sources.manage": "Manage signal sources and the signal taxonomy",
};

export function seedReference(tx: Tx): void {
  const insertPermission = tx.prepare(
    "INSERT INTO permission (key, description) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET description = excluded.description",
  );
  for (const key of PERMISSIONS) insertPermission.run(key, PERMISSION_DESCRIPTIONS[key]);

  const upsertRole = tx.prepare(
    "INSERT INTO role (id, key, name, description) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET name = excluded.name",
  );
  const grant = tx.prepare(
    "INSERT OR IGNORE INTO role_permission (role_id, permission_key) VALUES (?, ?)",
  );
  const revokeOthers = tx.prepare("DELETE FROM role_permission WHERE role_id = ?");
  for (const key of ROLE_KEYS) {
    // Role ids are the keys: stable across environments, so seeds are idempotent and diffable.
    upsertRole.run(key, key, ROLE_NAMES[key], ROLE_NAMES[key]);
    revokeOthers.run(key);
    for (const permission of FOUNDATION_ROLE_PERMISSIONS[key]) grant.run(key, permission);
  }
  seedFeature002(tx);
  seedFeature003(tx);
}
