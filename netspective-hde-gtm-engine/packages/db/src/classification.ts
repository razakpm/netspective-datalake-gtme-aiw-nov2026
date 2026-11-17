import { fields, mergeFields, type ClassificationRegistry } from "@gtm/domain";

// Data classification of every stored column (spec FR-015, task T072). Add an entry here in the same
// change as any new column; packages/db/test/classification.test.ts fails the build otherwise.
//   som = sensitive_operational_metadata, bc = business_contact, cc = confidential_commercial.

const som = (names: string) => fields("sensitive_operational_metadata", names);
const bc = (names: string) => fields("business_contact", names);
const cc = (names: string) => fields("confidential_commercial", names);

export const COLUMN_CLASSIFICATION: ClassificationRegistry = {
  schema_migration: som("name, checksum, applied_at"),
  audit_event: som(
    "id, occurred_at, actor_id, actor_type, action, entity_type, entity_id, outcome, before_summary, after_summary, correlation_id, prev_hash, row_hash",
  ),
  audit_retention_window: som("start_at, end_at"),
  outbox_event: som(
    "id, type, schema_version, occurred_at, actor_id, actor_type, correlation_id, causation_id, idempotency_key, payload, provenance, dispatched_at",
  ),
  phi_guard_decision: som(
    "id, occurred_at, entry_point, decision, rule_ids, guard_version, correlation_id, entity_ref",
  ),
  user: mergeFields(
    bc("email, display_name"),
    som("id, status, idp_subject, invited_by, last_sign_in_at, created_at"),
  ),
  invitation: som("id, user_id, expires_at, status, invited_by, created_at"),
  role: som("id, key, name, description"),
  permission: som("key, description"),
  role_permission: som("role_id, permission_key"),
  user_role: som("user_id, role_id, assigned_by, assigned_at"),
  // The stored response of a user call can hold an email address.
  idempotency_record: mergeFields(
    som(
      "id, actor_id, route, idempotency_key, request_hash, response_status, created_at, expires_at",
    ),
    bc("response_body"),
  ),
  // content_encrypted is the one column that may temporarily hold suspected-prohibited material: it is
  // encrypted at the application layer, time-limited and readable only through quarantine.review.
  quarantine_item: mergeFields(
    cc("content_encrypted"),
    som(
      "id, entry_point, reason_rule_ids, guard_version, content_sha256, status, created_at, held_until, decided_by, decided_at, decision_reason, released_consumed_at",
    ),
  ),
  job: som(
    "id, queue, idempotency_key, payload, state, attempts, max_attempts, next_run_at, scheduled_by, last_error, correlation_id, created_at, updated_at, finished_at",
  ),
  quarantine_access: som("id, item_id, actor_id, accessed_at, purpose"),

  // Feature 002 (accounts, contacts, ICP). Contact personal fields are business_contact data.
  account: mergeFields(
    cc("name, name_normalised, geography, notes"),
    som("id, merged_into, created_by, created_at, updated_at"),
  ),
  account_alias: mergeFields(
    cc("alias, alias_normalised"),
    som("id, account_id, current_until, source, created_at"),
  ),
  account_domain: mergeFields(cc("domain"), som("id, account_id, is_shared, created_at")),
  account_classification: mergeFields(
    cc("org_type, staffed_bed_count"),
    som("id, account_id, recorded_by, recorded_at"),
  ),
  contact: mergeFields(
    bc("full_name, business_email, profile_url"),
    som("id, email_hash, erased_at, created_at, updated_at"),
  ),
  contact_source: mergeFields(
    bc("documented_origin"),
    som("id, contact_id, source, basis, recorded_by, recorded_at"),
  ),
  stakeholder_role: som("key, label, sort"),
  evidence_reference: mergeFields(
    cc("what, where_ref"),
    som("id, account_id, contact_id, topic, observed_at, recorded_by, recorded_at, status"),
  ),
  account_contact_relationship: mergeFields(
    bc("title_stated, department"),
    som(
      "id, account_id, contact_id, role_inferred, role_confirmed, authority_status, started_at, ended_at, end_reason",
    ),
  ),
  relationship_evidence: som("relationship_id, evidence_id, purpose, linked_by, linked_at"),
  icp_definition: mergeFields(
    cc("rules"),
    som(
      "id, icp, version, state, status_label, created_by, created_at, activated_by, activated_at",
    ),
  ),
  icp_fit_assessment: mergeFields(
    cc("basis, met, unmet, missing, contradictory"),
    som(
      "id, account_id, icp, definition_id, definition_version, status, confidence, inputs_hash, assessed_by, assessed_at",
    ),
  ),
  icp_fit_ai_suggestion: mergeFields(
    cc("rationale, suggested_status, evidence_ids"),
    som("id, assessment_id, confidence_band, model, prompt_version, review_status, created_at"),
  ),
  exclusion_override: mergeFields(
    cc("rationale"),
    som("id, account_id, action, decided_by, decided_at"),
  ),
  suppression_record: som(
    "id, scope, contact_id, account_id, email_hash, action, reason, recorded_by, recorded_at",
  ),
  review_item: mergeFields(
    bc("proposed_values"),
    som(
      "id, kind, subject_a, subject_b, reason_codes, score, pair_key, attribute_fingerprint, state, proposed_at, decided_by, decided_at, decision_reason",
    ),
  ),
  import_run: som(
    "id, kind, file_sha256, row_count, state, counts, submitted_by, submitted_at, finished_at, job_id",
  ),
  import_row: som("import_run_id, row_number, outcome, reason_codes, entity_id, matched_id"),
  config_list: som("list, value, label, active, status_label"),
};
