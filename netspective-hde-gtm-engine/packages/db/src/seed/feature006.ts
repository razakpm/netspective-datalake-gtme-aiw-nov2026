import { DEFAULT_ICP_DEFINITIONS, RULE_SET_V1 } from "@gtm/domain";
import type { Tx } from "../sqlite/database.js";
import { SEED_AT } from "./feature005.js";

// Feature 006 reference data (task T015): routing rule set version 1, active, by the seed actor. The rule
// set, its priorities and the thresholds it relies on are hypotheses (open question #51). No notice version
// and no register file are seeded: both come from the business. Idempotent.

export function seedFeature006(tx: Tx): void {
  tx.prepare(
    `INSERT OR IGNORE INTO routing_rule_set
       (version, rules_json, state, author, reason, created_at, activated_by, activated_at, tests_passed_at)
     VALUES (1, ?, 'active', 'seed', ?, ?, 'seed', ?, ?)`,
  ).run(
    JSON.stringify(RULE_SET_V1),
    "Initial routing rule set (a hypothesis, open question 51); to be confirmed by the service lead",
    SEED_AT,
    SEED_AT,
    SEED_AT,
  );

  // The two default ICP definitions (the feature 002 slice built here): hypotheses, version 1, active.
  const definition = tx.prepare(
    `INSERT OR IGNORE INTO icp_definition
       (id, icp, version, state, rules, status_label, created_by, created_at, activated_by, activated_at)
     VALUES (?, ?, 1, 'active', ?, 'hypothesis', 'seed', ?, 'seed', ?)`,
  );
  for (const d of [DEFAULT_ICP_DEFINITIONS.icp1, DEFAULT_ICP_DEFINITIONS.icp2]) {
    definition.run(`icp-definition-${d.icp}-v1`, d.icp, JSON.stringify(d), SEED_AT, SEED_AT);
  }
}
