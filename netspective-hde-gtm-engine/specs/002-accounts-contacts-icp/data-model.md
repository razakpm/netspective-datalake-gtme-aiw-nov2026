# Data Model: Accounts, Contacts, Stakeholders and ICP Fit

Interim SQLite (ADR-015); migrations `0007`–`0010`, forward-only. Types shown as SQLite types; the Postgres port will use `uuid`, `citext`, `jsonb` and enums. All ids are UUID v7 text. All timestamps are ISO-8601 UTC text. "Append-only" tables get `BEFORE UPDATE`/`BEFORE DELETE` triggers raising an error (same pattern as 001 `audit_event`). Classification: **BC** business_contact, **CC** confidential_commercial, **SOM** sensitive_operational_metadata — every column below is registered in `COLUMN_CLASSIFICATION`.

## Migration 0007 — accounts

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `account` | `id` PK; `name` NOT NULL; `name_normalised` NOT NULL; `geography`; `notes`; `merged_into` FK account(id) NULL; `created_by`; `created_at`; `updated_at` | CC (ids/timestamps SOM) | Identity row. `merged_into` set only by a merge decision; merged accounts are read-only and excluded from lists. |
| `account_alias` | `id` PK; `account_id` FK; `alias`; `alias_normalised`; `current_until` NULL; `source` (`import\|rename\|merge\|manual`); `created_at` | CC | Former names keep `current_until` (FR-009). UNIQUE(`account_id`, `alias_normalised`). |
| `account_domain` | `id` PK; `account_id` FK; `domain` (lower-case hostname); `is_shared` INT 0/1; `created_at` | CC | UNIQUE(`account_id`, `domain`). Same domain on several accounts is allowed only if every holder has `is_shared = 1` (checked in service; flipping to shared is audited). |
| `account_classification` | `id` PK; `account_id` FK; `org_type` (fixed list, CHECK); `staffed_bed_count` INT NULL CHECK ≥ 0; `recorded_by`; `recorded_at` | CC | **Append-only history** (FR-010, FR-040a). Current = latest row. |

`org_type` values: `health_information_exchange`, `state_medicaid_program_operator`, `health_system`, `medtech`, `payer`, `multi_site_practice`, `biotech`, `other`, `unknown`. Excluded set (FR-027): `medtech`, `payer`, `multi_site_practice`, `biotech`.

Indexes: `account(name_normalised)`, `account_alias(alias_normalised)`, `account_domain(domain)`, `account_classification(account_id, recorded_at)`.

## Migration 0008 — contacts, relationships, evidence

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `contact` | `id` PK; `full_name` BC; `business_email` BC UNIQUE NULL; `email_hash` SOM NULL; `profile_url` BC NULL; `erased_at` NULL; `created_at`; `updated_at` | BC (ids SOM) | One row per person (FR-015). On erasure personal columns are set to NULL and `erased_at` set; the row id stays for audit references. `business_email` stored lower-cased. |
| `contact_source` | `id` PK; `contact_id` FK; `source` (configured list); `basis` (configured list); `documented_origin` TEXT NOT NULL; `recorded_by`; `recorded_at` | SOM / BC (`documented_origin` BC) | **Append-only**; current = latest. A contact cannot exist without one row (service rule + deferred check in import). |
| `stakeholder_role` | `key` PK; `label`; `sort` | SOM | Seeded 20 roles (FR-032). |
| `account_contact_relationship` | `id` PK; `account_id` FK; `contact_id` FK; `title_stated` BC; `department` BC; `role_inferred` FK stakeholder_role NULL; `role_confirmed` FK stakeholder_role NULL; `authority_status` (`unconfirmed\|confirmed`) DEFAULT `unconfirmed`; `started_at`; `ended_at` NULL; `end_reason` NULL | BC / SOM | UNIQUE(`account_id`, `contact_id`) where `ended_at IS NULL`. Title, inferred, confirmed are separate columns (FR-031). **Trigger** `acr_confirm_buyer`: setting `role_confirmed = 'economic_buyer'` or `authority_status = 'confirmed'` aborts unless a linked evidence row exists with status `buyer_confirmed`. |
| `evidence_reference` | `id` PK; `account_id` FK; `contact_id` FK NULL; `topic` (controlled list, CHECK); `what` (short text, guarded); `where_ref` (URL or identifier); `observed_at`; `recorded_by`; `recorded_at`; `status` (`observed\|buyer_confirmed\|derived_interpretation\|ai_hypothesis\|unverified_assumption\|contradictory`) | CC | Minimal; feature 003 extends. `topic` is one of `sender_onboarding_friction`, `ig_change_friction`, `stalled_ai_pilot`, `demonstrated_data_problem`, `generic_ai_interest`, `mid_size_judgement`, `economic_buyer_confirmation`, `other`; criteria of kind `evidence_present` and `analyst_judgement` match on it. **Append-only.** `what` capped at 500 chars and PHI-guarded. |
| `relationship_evidence` | `relationship_id` FK; `evidence_id` FK; `purpose` (`role_confirmation\|authority`); `linked_by`; `linked_at` | SOM | PK (`relationship_id`, `evidence_id`, `purpose`). |

Contact-source and basis lists, and the personal mailbox-domain list, live in `config_list` (below) so they are configurable (FR-013, FR-012).

## Migration 0009 — ICP

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `icp_definition` | `id` PK; `icp` (`icp1\|icp2`); `version` INT; `state` (`draft\|active\|retired`); `rules` TEXT (JSON, validated by Zod); `status_label` DEFAULT `hypothesis`; `created_by`; `created_at`; `activated_by` NULL; `activated_at` NULL | CC | UNIQUE(`icp`, `version`); partial UNIQUE index on (`icp`) WHERE `state='active'`. `rules` immutable once row exists (trigger); only `state`/activation fields may change, and only `draft→active`, `active→retired`. |
| `icp_fit_assessment` | `id` PK; `account_id` FK; `icp`; `definition_id` FK; `definition_version` INT; `status` (`strong\|possible\|weak\|excluded\|unknown`); `confidence` (`low\|medium\|high`); `basis` JSON NOT NULL (non-empty array of `{kind: account_classification|evidence|missing_info, ref}` — the evidence this conclusion rests on, so Constitution I holds even for `excluded` and `unknown`); `met` JSON; `unmet` JSON; `missing` JSON; `contradictory` JSON; `inputs_hash`; `assessed_by`; `assessed_at` | CC | **Append-only**. `met`/`unmet` items: `{criterion_id, label, evidence_ids[]}`. `inputs_hash` = hash of (account snapshot + evidence ids/status + definition id) so identical inputs are provably identical. No intent column (FR-024). |
| `icp_fit_ai_suggestion` | `id` PK; `assessment_id` FK; `suggested_status`; `rationale`; `evidence_ids` JSON; `confidence_band`; `model`; `prompt_version`; `review_status`; `created_at` | CC | Always labelled AI/advisory; never read by eligibility. Empty until feature 004. |
| `exclusion_override` | `id` PK; `account_id` FK; `action` (`grant\|revoke`); `rationale` NOT NULL, ≥ 10 chars; `decided_by`; `decided_at` | CC | **Append-only**; current = latest row per account (FR-028, FR-029). Original exclusion stays in assessments. |

## Migration 0010 — suppression, review, imports, config

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `suppression_record` | `id` PK; `scope` (`contact\|account`); `contact_id` FK NULL; `account_id` FK NULL; `email_hash` NULL; `action` (`add\|lift\|erase_marker`); `reason` NOT NULL; `recorded_by`; `recorded_at` | SOM | **Append-only**. CHECK: scope `contact` ⇒ `contact_id` or `email_hash` set; scope `account` ⇒ `account_id` set. Active = latest `add`/`erase_marker` with no later `lift` for the same target. `email_hash` = HMAC-SHA256 keyed by `SUPPRESSION_HASH_KEY`. |
| `review_item` | `id` PK; `kind` (`merge_candidate\|contact_conflict`); `subject_a`; `subject_b` NULL; `reason_codes` JSON; `score` REAL NULL; `pair_key` UNIQUE-per-open; `attribute_fingerprint`; `state` (`open\|merged\|rejected\|accepted`); `proposed_at`; `decided_by` NULL; `decided_at` NULL; `decision_reason` NULL; `proposed_values` JSON NULL | CC (contact conflict values BC) | Shared queue (FR-005/006/015). Terminal states immutable (trigger). `pair_key` of rejected items blocks re-proposal until `attribute_fingerprint` changes. |
| `import_run` | `id` PK; `kind` (`accounts\|contacts`); `file_sha256`; `row_count`; `state` (`queued\|running\|completed\|failed\|rejected`); `counts` JSON; `submitted_by`; `submitted_at`; `finished_at`; `job_id` | SOM | Raw file never stored. `rejected` = whole-file rejection (headers, size, encoding). |
| `import_row` | `import_run_id` FK; `row_number`; `outcome` (`created\|updated\|unchanged\|rejected\|flagged\|conflict`); `reason_codes` JSON; `entity_id` NULL; `matched_id` NULL | SOM | PK (`import_run_id`, `row_number`). **No row content.** Reason codes only (e.g. `missing_source`, `personal_email`, `unknown_account`, `phi_guard:<rule_id>`). |
| `config_list` | `list` (`contact_source\|permitted_basis\|personal_domain\|org_type`); `value`; `label`; `active` INT; `status_label` DEFAULT `hypothesis` | SOM | Seeded; administrator-editable later (UI out of scope; seed + API read only here). |

## Relationships

```text
account 1─* account_alias, account_domain, account_classification, icp_fit_assessment, exclusion_override, evidence_reference
account 1─* account_contact_relationship *─1 contact 1─* contact_source
account_contact_relationship *─* evidence_reference (relationship_evidence)
icp_definition 1─* icp_fit_assessment 1─* icp_fit_ai_suggestion
suppression_record ─> contact | account (by id) or email_hash
review_item ─> account|contact pairs;  import_run 1─* import_row
```

## State transitions

- **Import row**: validated → `created` | `updated` | `unchanged` | `rejected` | `flagged` (merge candidate raised) | `conflict` (contact differs from record on file). Terminal.
- **Import run**: `queued → running → completed|failed`; whole-file problems → `rejected` at submit, nothing queued.
- **Review item**: `open → merged|rejected` (accounts) or `open → accepted|rejected` (contact conflict); terminal states immutable; rejected pair re-opens only when `attribute_fingerprint` changes.
- **ICP definition**: `draft → active → retired`; one `active` per ICP.
- **Exclusion override**: `grant` / `revoke` rows alternate; eligibility reads the latest.
- **Suppression**: `add` ⇄ `lift` rows; `erase_marker` is permanent (not liftable except by an administrator `lift` row recorded with a reason).
- **Relationship**: active (`ended_at NULL`) → ended (date + reason). History kept.

## Validation rules (code → test)

| Rule | Where | Spec |
|------|-------|------|
| Whole-file header/size/encoding validation, per-row validation | `csv/parse.ts`, import services | FR-001/002/011 |
| Row PHI guard before any write | import services via 001 guard | FR-018, FR-050 |
| Source + basis required; personal domain rejected; account must exist | `contacts/validate-contact.ts` | FR-012–FR-014 |
| Candidate detection incl. shared-domain and type/geo gate | `accounts/resolve.ts` | FR-004, FR-008 |
| Economic buyer confirmation requires `buyer_confirmed` evidence (code + trigger) | `contacts/roles.ts`, `acr_confirm_buyer` | FR-033 |
| AI actors cannot set confirmed roles or lift/override | permission restriction + actor-type check | constitution II, VIII |
| Definition must have ≥1 criterion and an evaluable status rule set | `icp/definition.ts` | FR-039 |
| Override rationale non-empty; admin only | `icp/overrides.ts` | FR-028 |
| Suppression check by person across accounts and erase markers | `contacts/suppression.ts` | FR-041–FR-045 |

## Events (outbox, ids only)

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `account.created` | `account_id`, `org_type`, `source: import\|manual` | Account row created |
| `contact.identified` | `contact_id`, `account_id`, `source` | New contact attached to an account |
| `icp.fit_assessed` | `assessment_id`, `account_id`, `icp`, `status`, `definition_version` | Assessment stored |

## Audit actions added

`accounts.import`, `account.update`, `account.merge`, `review.reject`, `contact.import`, `contact.update`, `contact.conflict.resolve`, `contact.erase`, `relationship.role.change`, `relationship.end`, `evidence.record`, `icp.definition.create`, `icp.definition.activate`, `icp.assess`, `icp.override.grant`, `icp.override.revoke`, `suppression.add`, `suppression.lift`, plus audited refusals for each restricted action.
