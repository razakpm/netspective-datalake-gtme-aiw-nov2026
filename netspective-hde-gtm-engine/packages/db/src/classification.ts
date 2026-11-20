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

  // Feature 003 (signals and evidence). Free text from sources is confidential commercial data.
  taxonomy_version: som("version, status, released_at, approved_by, note, status_label"),
  signal_type: som(
    "taxonomy_version, key, category, label, kind, default_freshness_days, default_reliability, context_only, status, status_label",
  ),
  signal_source: mergeFields(
    cc("name"),
    som(
      "id, kind, default_reliability, storage_rule, excerpt_max_chars, availability, unavailable_since, created_by, created_at, status_label",
    ),
  ),
  signal: mergeFields(
    cc(
      "source_ref, source_ref_normalised, item_key, observation, excerpt, approval_citation, regulatory_item",
    ),
    som(
      "id, account_id, contact_id, type_key, taxonomy_version, source_id, excerpt_withheld_reason, observed_at, collected_at, published_at, undated, reliability, reliability_overridden_by, extraction_method, extraction_confidence, ai_model, ai_prompt_version, evidence_status, review_status, new_provenance_flag, freshness_days, fresh_until, freshness_state, funding_class, regulatory_status, context_only, reverify_required, retention_policy, retain_until, purged_at, sensitivity, content_fingerprint, created_by, created_by_type, created_at, updated_at",
    ),
  ),
  signal_provenance: som(
    "id, signal_id, seq, kind, actor_id, actor_type, method, source_id, source_ref, detail, occurred_at",
  ),
  signal_tag: som("signal_id, dimension, value"),
  signal_link: som("id, signal_id, entity_type, entity_id, role, linked_by, linked_at"),
  evidence_artifact: mergeFields(
    cc("storage_ref"),
    som("id, signal_id, kind, sha256, size_bytes, classification, retain_until, created_at"),
  ),
  signal_review: mergeFields(
    cc("reason"),
    som("id, signal_id, decision, contradicts_signal_id, reliability_set, decided_by, decided_at"),
  ),
  signal_contradiction: som(
    "id, signal_a, signal_b, created_by, created_at, resolved_at, resolved_by",
  ),

  // Feature 004 (account research and hypotheses). Finding statements and quotes are source-derived
  // text, so confidential commercial; nothing here stores a prompt, a response or a reasoning trace.
  prompt_version: som(
    "id, name, version, template_hash, output_schema_id, output_schema_version, status, approved_by, approved_at",
  ),
  ai_invocation: som(
    "id, occurred_at, provider, model, task, prompt_version_id, schema_version, context_type, context_id, account_id, attempt, input_tokens, output_tokens, cost_micros, latency_ms, validation_result, outcome, refusal_rule_ids, correlation_id, actor_id, actor_type",
  ),
  research_source_rule: mergeFields(
    cc("pattern"),
    som("id, kind, match_type, status, signal_source_kind, created_by, created_at, status_label"),
  ),
  research_run: mergeFields(
    cc("requested_sources, summary_json, attention_note"),
    som(
      "id, account_id, started_by, trigger, state, max_sources, max_cost_micros, reserved_micros, cost_micros, input_tokens, output_tokens, sources_read, dropped_uncited, dropped_unsupported, dropped_protected, dropped_taxonomy, injection_flags, retries, icp_excluded, stop_reason, summary_prompt_version_id, attention_ack_by, attention_ack_at, correlation_id, created_at, started_at, finished_at",
    ),
  ),
  research_source_fetch: mergeFields(
    cc("address, address_normalised, final_address, permitted_excerpt"),
    som(
      "id, run_id, rule_id, outcome, http_status, content_sha256, size_bytes, truncated, injection_rule_ids, flagged, fetched_at",
    ),
  ),
  research_finding: mergeFields(
    cc("statement, supporting_text"),
    som(
      "id, run_id, fetch_id, kind, topic, supporting_text_sha256, basis_finding_ids, second_fetch_id, type_key, extraction_confidence, verified, signal_id, signal_refusal_codes, carried_over_from_run, created_at",
    ),
  ),
  research_schedule: som(
    "account_id, cadence, next_run_at, enabled, created_by, created_at, updated_at",
  ),
  hypothesis_category: som("key, label, active, status_label"),
  service_capability_provisional: som("key, label, active, status_label"),
  account_hypothesis: mergeFields(
    cc("statement, proposed_statement, confidence_explanation"),
    som(
      "id, account_id, origin, acceptance, category, status, not_for_prioritisation, confidence_band, proposed_by_run_id, ai_model, ai_prompt_version_id, created_by, created_at, accepted_by, accepted_at, last_revived_at, last_reviewed_at, flagged_for_review, flag_reason, updated_at",
    ),
  ),
  hypothesis_tag: som("hypothesis_id, dimension, value"),
  hypothesis_evidence: som(
    "id, hypothesis_id, signal_id, role, linked_by, linked_by_type, linked_at",
  ),
  hypothesis_assumption: mergeFields(
    cc("text"),
    som("id, hypothesis_id, source, interpretation_id, added_by, added_at"),
  ),
  hypothesis_status_decision: mergeFields(
    cc("note"),
    som(
      "id, hypothesis_id, from_status, to_status, decided_by, decided_by_type, reason_code, decided_at",
    ),
  ),
  confidence_assessment: mergeFields(
    cc("explanation"),
    som(
      "id, subject_type, subject_id, dimension, band, assessed_by_type, assessed_by, assessed_at",
    ),
  ),
  problem_interpretation: mergeFields(
    cc("matches_json, questions_json, unknowns_json"),
    som(
      "id, account_id, source_signal_id, statement_sha256, ai_model, ai_prompt_version_id, requested_by, cost_micros, created_at",
    ),
  ),
  // Feature 005 (capabilities, offers, claims). Delivery example text is internal-only.
  restricted_phrase_list: mergeFields(
    cc("rules_json, note"),
    som("version, owner, reviewed_by, reviewed_at, created_by, created_at"),
  ),
  claim: mergeFields(
    cc("text"),
    som("id, declared_class, effective_class, status, drafted_by, drafted_at, version_no"),
  ),
  claim_evidence: mergeFields(
    cc("reference"),
    som("id, claim_id, kind, owner, added_by, added_at, expires_at, withdrawn_at, withdrawn_by"),
  ),
  claim_review: mergeFields(cc("note"), som("id, claim_id, decision, reviewer_id, decided_at")),
  lint_disposition: mergeFields(
    cc("reason"),
    som("id, sentence_hash, rule_id, reviewer_id, decided_at"),
  ),
  engagement_offer: som(
    "id, number, key, latest_version_no, in_force_version_no, lock_no, created_at",
  ),
  offer_version: mergeFields(
    cc("snapshot_json, reason"),
    som("offer_id, version_no, snapshot_hash, created_by, created_at"),
  ),
  offer_version_status: mergeFields(
    cc("note"),
    som("id, offer_id, version_no, status, changed_by, changed_at"),
  ),
  offer_limitation: mergeFields(cc("wording"), som("id, offer_id, key, active")),
  offer_limitation_ack: som("id, limitation_id, wording_hash, acknowledged_by, acknowledged_at"),
  offer_capacity: mergeFields(
    cc("reason"),
    som("id, offer_id, period_kind, limit_sessions, effective_from, set_by, set_at"),
  ),
  offer_session_booking: som(
    "id, offer_id, external_ref, state, session_date, period_start, source, recorded_by, recorded_at, updated_at",
  ),
  offer_score_criterion: som("key, label, position"),
  offer_score: mergeFields(
    cc("rationale"),
    som("id, offer_id, criterion_key, score, status, set_by, set_at"),
  ),
  paid_engagement_type: mergeFields(
    cc("scope_json"),
    som("key, name, weeks_min, weeks_max, scope_confirmed, status, lock_no"),
  ),
  paid_engagement_deliverable: mergeFields(
    cc("text"),
    som("id, type_key, in_source, approval, approved_by, decided_at"),
  ),
  service_capability: mergeFields(
    cc(
      "name, description, input_types_json, output_types_json, buyer_problems_json, limitations_json, required_expertise",
    ),
    som("id, slot, potential_paid_type_key, public_claim_status, public_claim_id, lock_no"),
  ),
  capability_evidence: mergeFields(
    cc("reference, note"),
    som("id, capability_id, basis_kind, added_by, added_at"),
  ),
  capability_delivery_example: mergeFields(
    fields("internal_case_study_restricted", "text"),
    som("id, capability_id, added_by, added_at"),
  ),
  capability_offer_link: som("capability_id, offer_id"),
};
