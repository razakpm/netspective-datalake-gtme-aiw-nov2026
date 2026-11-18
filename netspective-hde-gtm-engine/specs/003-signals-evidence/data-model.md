# Data Model: Signals and Evidence

Interim SQLite (ADR-015); migrations `0011`–`0013`, forward-only. Types are SQLite types; the Postgres port will use `uuid`, enums, `jsonb` and `timestamptz`. All ids are UUID v7 text; all timestamps are ISO-8601 UTC text. "Append-only" tables get `BEFORE UPDATE`/`BEFORE DELETE` triggers raising an error. Classification: **BC** business_contact, **CC** confidential_commercial, **SOM** sensitive_operational_metadata. Every column is registered in `COLUMN_CLASSIFICATION`. **No column anywhere may express funding path, ICP fit, hypothesis, intent or a buyer decision** (a schema test scans column names).

## Migration 0011 — taxonomy and sources

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `taxonomy_version` | `version` INTEGER PK; `status` (`current\|retired`); `released_at`; `approved_by`; `note`; `status_label` DEFAULT `hypothesis` | SOM | Exactly one `current` row (partial unique index on `status` WHERE `status='current'`). |
| `signal_type` | `taxonomy_version` FK; `key`; `category` CHECK IN (`A`..`I`); `label`; `kind` (`general\|funding\|regulatory\|first_party`); `default_freshness_days` INTEGER CHECK > 0; `default_reliability` (`high\|medium\|low\|unknown`); `context_only` INT 0/1; `status` (`active\|retired`); `status_label` DEFAULT `hypothesis` | SOM | PK (`taxonomy_version`, `key`). Kind `regulatory` ⇒ `context_only = 1` (CHECK); category `H` ⇔ kind `regulatory` (CHECK); category `I` ⇔ kind `first_party`; category `E` types may be `funding` or `general`. |
| `signal_source` | `id` PK; `name` UNIQUE NOT NULL; `kind` (`official_publication\|buyer_statement\|third_party\|analyst_observation\|provider\|first_party\|other`); `default_reliability`; `storage_rule` (`excerpt\|citation_only`) DEFAULT `citation_only`; `excerpt_max_chars` INTEGER NULL CHECK (NULL or ≥ 0); `availability` (`available\|unavailable`) DEFAULT `available`; `unavailable_since` NULL; `created_by`; `created_at`; `status_label` DEFAULT `hypothesis` | CC (ids/timestamps SOM) | CHECK: `storage_rule='citation_only'` ⇒ `excerpt_max_chars` IS NULL or 0. Never deleted. |

Seeded (`packages/db/src/seed/feature003.ts`): taxonomy version 1 (`status='current'`, hypothesis types A–I from the spec), plus default sources for common kinds. All seed rows carry `status_label = hypothesis`.

## Migration 0012 — signals

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `signal` | `id` PK; `account_id` FK NOT NULL; `contact_id` FK NULL; `type_key` NOT NULL; `taxonomy_version` INT NOT NULL (FK with `type_key` to `signal_type`); `source_id` FK NOT NULL; `source_ref` TEXT NOT NULL; `source_ref_normalised` TEXT NOT NULL; `item_key` TEXT NULL; `observation` TEXT NOT NULL CHECK length ≤ 1000; `excerpt` TEXT NULL; `excerpt_withheld_reason` (`none\|too_long\|source_no_storage`) DEFAULT `none`; `observed_at` NOT NULL; `collected_at` NOT NULL; `published_at` NULL; `undated` INT 0/1; `reliability` (`high\|medium\|low\|unknown`) NOT NULL; `reliability_overridden_by` NULL; `extraction_method` (`manual\|provider\|ai_extracted`) NOT NULL; `extraction_confidence` (`low\|medium\|high`) NOT NULL; `ai_model` NULL; `ai_prompt_version` NULL; `evidence_status` (`observed\|buyer_confirmed\|derived_interpretation\|ai_hypothesis\|unverified_assumption\|contradictory`) NOT NULL; `review_status` (`pending\|approved\|rejected\|contradictory`) DEFAULT `pending`; `new_provenance_flag` INT 0/1 DEFAULT 0; `freshness_days` INT NOT NULL CHECK > 0; `fresh_until` NOT NULL; `freshness_state` (`fresh\|stale`) DEFAULT `fresh`; `funding_class` (`none\|context\|budget_approval_evidence`) DEFAULT `none`; `approval_citation` NULL; `regulatory_item` NULL; `regulatory_status` NULL (`proposed\|unverified\|reported_final`); `context_only` INT 0/1; `reverify_required` INT 0/1; `retention_policy` NOT NULL; `retain_until` NOT NULL; `purged_at` NULL; `sensitivity` (`public\|business_contact\|confidential_commercial\|internal_case_study_restricted\|sensitive_operational_metadata`) NOT NULL; `content_fingerprint` NOT NULL; `created_by`; `created_by_type` (`human\|ai\|system`); `created_at`; `updated_at` | CC; `contact_id`, `created_by` SOM; free text (`observation`, `excerpt`, `source_ref`, `approval_citation`) CC | See constraints below. |
| `signal_provenance` | `id` PK; `signal_id` FK; `seq` INTEGER; `kind` (`first_recorded\|merged_duplicate\|republication\|reviewed\|reverified\|flag_cleared\|source_unavailable\|retention`); `actor_id` NULL; `actor_type`; `method`; `source_id` NULL; `source_ref` NULL; `detail` TEXT (JSON of codes and ids only); `occurred_at` | SOM | UNIQUE (`signal_id`, `seq`). **Append-only.** No free text. |
| `signal_tag` | `signal_id` FK; `dimension` (`icp\|capability\|offer`); `value` | SOM | PK (`signal_id`, `dimension`, `value`). `icp` values ∈ {`icp1`,`icp2`}; capability and offer values are free keys of 1–60 `[a-z0-9_]` characters until feature 005 supplies registries. Advisory only. |
| `signal_link` | `id` PK; `signal_id` FK; `entity_type` (`evidence_reference\|icp_fit_assessment\|signal`); `entity_id`; `role` (`supporting\|contradictory`); `linked_by`; `linked_at` | SOM | UNIQUE (`signal_id`, `entity_type`, `entity_id`, `role`). The supporting and contradictory lists of a signal are the rows with that `signal_id` (always present, possibly empty). Append-only. |
| `evidence_artifact` | `id` PK; `signal_id` FK; `kind` (`page_capture\|document\|attachment_metadata`); `storage_ref`; `sha256`; `size_bytes` INT ≥ 0; `classification` (not `prohibited`); `retain_until`; `created_at` | CC | Metadata only; content upload is out of scope here. |

**Constraints on `signal` (verbatim)**

- Source is mandatory: `source_id` NOT NULL and `source_ref` NOT NULL and length > 0 (FR-002).
- `observation` NOT NULL and "length ≤ 1000"; `excerpt` NULL when `excerpt_withheld_reason <> 'none'`; `excerpt` length ≤ 1000 hard cap (the effective, shorter limit is enforced by `excerpt.ts`).
- `extraction_method = 'ai_extracted'` ⇒ `ai_model` and `ai_prompt_version` NOT NULL (CHECK).
- `evidence_status = 'buyer_confirmed'` ⇒ `extraction_method = 'manual'` and `created_by_type = 'human'` (CHECK).
- `created_by_type IN ('ai','system')` ⇒ `review_status = 'pending'` at insert (trigger).
- `funding_class <> 'none'` only when the type's kind is `funding` (service and trigger); `funding_class = 'budget_approval_evidence'` ⇒ `approval_citation` NOT NULL (CHECK).
- `regulatory_status` NOT NULL only for kind `regulatory`; kind `regulatory` ⇒ `context_only = 1` and `reverify_required = 1` at insert (CHECK on insert path via trigger).
- `sensitivity` is never `prohibited` (CHECK list above).
- **Immutable after insert** (`BEFORE UPDATE OF` trigger): `account_id`, `contact_id` (except to NULL on contact erasure), `type_key`, `taxonomy_version`, `source_id`, `source_ref`, `observation`, `excerpt`, `observed_at`, `collected_at`, `published_at`, `extraction_method`, `content_fingerprint`. Exception: when `purged_at` is being set (retention).
- UNIQUE (`account_id`, `type_key`, `content_fingerprint`) — one signal per account, type and content (the merge target); partial UNIQUE (`account_id`, `type_key`, `item_key`) WHERE `item_key IS NOT NULL`.
- Indexes: (`account_id`, `created_at`), (`review_status`, `fresh_until`), (`type_key`), (`source_id`), (`freshness_state`), (`extraction_confidence`), `signal_tag` (`dimension`, `value`).

## Migration 0013 — review

| Table | Columns | Class | Notes |
|-------|---------|-------|-------|
| `signal_review` | `id` PK; `signal_id` FK; `decision` (`approve\|reject\|contradict\|reverify\|clear_flag`); `reason` TEXT NULL; `contradicts_signal_id` FK NULL; `decided_by` NOT NULL; `decided_at` | CC (`reason`) / SOM | CHECK: `reject` ⇒ `reason` NOT NULL and length ≥ 3; `contradict` ⇒ `contradicts_signal_id` NOT NULL and ≠ `signal_id`; `reverify` ⇒ `reason` NOT NULL. **Append-only.** |
| `signal_contradiction` | `id` PK; `signal_a` FK; `signal_b` FK; `created_by`; `created_at`; `resolved_at` NULL; `resolved_by` NULL | SOM | CHECK `signal_a < signal_b` (sorted pair), UNIQUE (`signal_a`, `signal_b`). Only `resolved_*` may be updated, once. |

## Relationships

```text
taxonomy_version 1─* signal_type;  signal_type *─1 signal (type_key + taxonomy_version)
account 1─* signal *─1 signal_source;  contact 0..1─* signal
signal 1─* signal_provenance | signal_tag | signal_link | signal_review | evidence_artifact
signal_link ─> evidence_reference (feature 002) | icp_fit_assessment (002) | signal
signal_contradiction ─> signal_a, signal_b
```

## State transitions

- **Review status**: `pending → approved | rejected | contradictory`; `approved → rejected | contradictory`; `rejected → approved` (a changed mind is a new review row); `contradictory → approved | rejected` per signal; resolved pair when neither remains `contradictory`.
- **Freshness**: `fresh → stale` when `now ≥ fresh_until` (computed; the job materialises it). No path back to fresh; a re-observation is a new signal or a merge.
- **Merge flag**: `new_provenance_flag 0 → 1` on a merge into an approved signal; `1 → 0` by a `clear_flag` review.
- **Regulatory flag**: `reverify_required 1 → 0` by a `reverify` review only.
- **Source availability**: `available → unavailable` (one provenance entry per signal) and back; reliability is not changed by it.
- **Retention**: after `retain_until`, `purged_at` is set and observation/excerpt are replaced by a removal marker; citation and provenance remain.

## Validation rules (code → test)

| Rule | Where | Spec |
|------|-------|------|
| Source mandatory; type in the current taxonomy; account and contact valid | `signals/validate.ts` | FR-002, FR-003, FR-006 |
| No field can express a conclusion | schema scan test over column names | FR-005 |
| One evidence status; AI/provider cannot set `buyer_confirmed` or override reliability | `validate.ts`, CHECK and trigger | FR-008, FR-009 |
| PHI guard on every text field; refusal audited with rule IDs only | `service.ts` | FR-016 |
| Effective excerpt limit = shorter of global and source limit; citation-only sources store no excerpt | `signals/excerpt.ts` | FR-017–FR-019 |
| Duplicate decision: identical / republication / duplicate / new | `signals/dedup.ts` | FR-020–FR-024 |
| Freshness anchor, stale, current evidence | `signals/freshness.ts` | FR-031–FR-034 |
| Funding classification; no funding path anywhere | `signals/funding.ts`, schema scan | FR-035, FR-036 |
| Regulatory context-only, re-verify flag, HTI-5 never final | `signals/regulatory.ts` | FR-037–FR-039 |
| Review needs permission; reject needs reason; contradict names a signal | `review.ts`, CHECK | FR-025–FR-027 |

## Events (outbox, ids only)

| Event | Payload | Emitted when |
|-------|---------|--------------|
| `signal.discovered` | `signal_id`, `account_id`, `type_key`, `merged` | A signal is recorded or a duplicate merges |
| `signal.reviewed` | `signal_id`, `decision`, `review_status` | A review decision is recorded |

## Audit actions added

`signal.record`, `signal.merge`, `signal.review.approve`, `signal.review.reject`, `signal.review.contradict`, `signal.review.reverify`, `signal.review.clear_flag`, `signal.stale`, `signal.source.create`, `signal.source.update`, `signal.source.unavailable`, `signal.retention`, plus audited refusals (`signal.record.refused`, each `*.denied`) and PHI refusals (rule IDs only).
