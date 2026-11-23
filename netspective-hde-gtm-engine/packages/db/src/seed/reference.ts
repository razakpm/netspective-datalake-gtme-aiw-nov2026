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
import { seedFeature004 } from "./feature004.js";
import { seedFeature005 } from "./feature005.js";
import { seedFeature006 } from "./feature006.js";

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
  "research.read": "View research runs and summaries",
  "research.run": "Start and cancel research runs and interpret problem statements",
  "research.sources.manage": "Manage the approved research source list",
  "hypotheses.read": "View account hypotheses",
  "hypotheses.edit": "Create, accept, edit and link evidence to hypotheses",
  "hypotheses.review": "Change the status of hypotheses (reviewers only)",
  "capabilities.read": "View service capabilities (without internal delivery examples)",
  "capabilities.edit": "Edit service capabilities, evidence and links",
  "capabilities.examples.read": "View internal delivery examples of capabilities",
  "offers.read": "View engagement offers, versions, capacity and scores",
  "offers.edit": "Create offer versions, edit scores and criteria",
  "offers.status.change": "Move an offer version through its statuses",
  "offers.limitations.acknowledge": "Acknowledge a recorded offer limitation",
  "offers.capacity.edit": "Set capacity limits per offer and period",
  "offers.bookings.edit": "Record, reschedule and cancel session bookings",
  "claims.read": "View claims, evidence, reviews and the restricted phrase list",
  "claims.draft": "Draft claims and add evidence",
  "claims.approve": "Approve or reject claims and mark false positives (designated approvers only)",
  "claims.phrases.manage": "Propose new versions of the restricted phrase list",
  "paid_types.edit": "Edit paid engagement types and propose deliverables",
  "paid_types.approve":
    "Approve deliverables not in the source material (designated approvers only)",
  "offers.recommend": "Request, accept and dismiss offer recommendations",
  "requests.read": "View the request inbox: downloads, session requests and intake submissions",
  "requests.review": "Review, link and close requests from the public forms",
  "waitlist.edit": "Add accounts to an offer's wait-list and release or remove entries",
  "routing.rules.manage":
    "Create and activate routing rule set versions (service lead or administrator only)",
  "notices.manage": "Draft privacy notice and consent wording versions",
  "notices.approve": "Approve notice and consent wording before a form shows it (approvers only)",
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
  seedFeature004(tx);
  seedFeature005(tx);
  seedFeature006(tx);
}
