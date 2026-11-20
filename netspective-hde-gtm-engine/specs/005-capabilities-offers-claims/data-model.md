# Data Model: Service Capabilities, Offer Catalog and Claims

Persistence is the interim SQLite adapter behind `Tx` (ADR-015); migrations `0017_claims.sql`, `0018_offers.sql`, `0019_capabilities.sql`. Identifiers are text (uuid v7) except seeded rows, which use stable keys. Times are ISO-8601 UTC text. Every column is registered in `COLUMN_CLASSIFICATION`. **Append-only** tables have triggers that refuse UPDATE and DELETE. A null in a content attribute means "to be provided" (research R-02).

## Claims (`0017_claims.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `restricted_phrase_list` | `version` int PK; `rules_json` text not null (array of rule objects); `owner` text not null; `reviewed_by` text not null; `reviewed_at`; `created_by`; `created_at`; `note` | Append-only. `reviewed_by` must differ from `created_by`. Current = highest version. Version 1 seeded from the default list. |
| `claim` | `id` PK; `text` not null, max 600; `declared_class` text null, one of the eight restricted classes or `general`; `effective_class` text not null (union of declared and checker-found; never lower than found); `status` in (`draft`,`in_review`,`approved`,`rejected`,`withdrawn`); `drafted_by` not null; `drafted_at`; `version_no` int not null (optimistic) | `needs_review` is **computed** at read from evidence, not stored. Text refused if the PHI guard matches. |
| `claim_evidence` | `id` PK; `claim_id` FK; `kind` in (`document`,`published_page`,`internal_record`,`approved_case_study`); `reference` not null (an identifier or address, never document text); `owner` not null; `added_by`; `added_at`; `expires_at` not null (default now plus `CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS`); `withdrawn_at` null; `withdrawn_by` | Evidence is withdrawn by setting `withdrawn_*` once (not deleted). |
| `claim_review` | `id` PK; `claim_id` FK; `decision` in (`approve`,`reject`); `reviewer_id` not null; `note` not null, min 3; `decided_at` | Append-only. Unique (`claim_id`,`reviewer_id`,`decision`). Reviewer must not equal `drafted_by`. |
| `lint_disposition` | `id` PK; `sentence_hash` text not null (SHA-256 of the normalised sentence); `rule_id` not null; `reason` not null, min 3; `reviewer_id` not null; `decided_at` | Append-only. A false positive applies to that exact sentence and rule only. |

Effective claim state (computed): `approved` stays approved only while it has at least one evidence row that is not withdrawn and not past `expires_at`; otherwise it reads as `needs_review`. A restricted claim is `approved` only with at least two `approve` reviews from different reviewers, no `reject`, and valid evidence; a general claim needs one.

## Offers (`0018_offers.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `engagement_offer` | `id` PK (`offer-1`..`offer-10`); `number` int unique 1..10; `key` text unique; `latest_version_no` int; `in_force_version_no` int null; `lock_no` int not null (optimistic); `created_at` | Head only; no content. |
| `offer_version` | `offer_id` FK; `version_no` int; PK (`offer_id`,`version_no`); `snapshot_json` text not null; `snapshot_hash` text not null (SHA-256); `reason` not null; `created_by` not null; `created_at` | Append-only. Snapshot fields: name, format, target ICP, buyer output, buyer effort, Netspective effort estimate (with `estimate_status: "hypothesis"` always), conversion path, landing-page promise, CTA, intake fields (list), success hypotheses (list), SQL rule reference, related capability keys, paid engagement type key. |
| `offer_version_status` | `id` PK; `offer_id`; `version_no`; FK to `offer_version`; `status` in (`draft`,`internally_reviewed`,`approved`,`available`,`withdrawn`,`expired`); `changed_by` not null (user id or `seed`); `note`; `changed_at` | Append-only. A version's status is its latest row. Allowed moves: draft → internally_reviewed → approved → available; approved or available → withdrawn; approved or available → expired. No move out of withdrawn or expired. |
| `offer_limitation` | `id` PK; `offer_id` FK; `key` not null; `wording` not null; `active` 0/1; unique (`offer_id`,`key`) | Offer 7 seeded with `evaluation_is_buyer_prompt_only`, wording "Evaluation is a buyer prompt only", active. Wording change is a new row version via `lock_no` on the head and keeps the hash check below. |
| `offer_limitation_ack` | `id` PK; `limitation_id` FK; `wording_hash` not null; `acknowledged_by` not null; `acknowledged_at` | Append-only. Valid while `wording_hash` equals the hash of the current wording. |
| `offer_capacity` | `id` PK; `offer_id` FK; `period_kind` in (`week`,`month`); `limit_sessions` int not null, 0 or more; `effective_from` date not null; `set_by` not null; `set_at`; `reason` | Append-only limit history. The row with the latest `effective_from` not after the period start applies. Seeded as **hypotheses**: Offer 6, month, 3; Offer 1, week, 3 (open questions 6 and 7). |
| `offer_session_booking` | `id` PK; `offer_id` FK; `external_ref` text null; `state` in (`booked`,`held`,`cancelled`,`no_show`); `session_date` date not null; `period_start` date not null; `source` in (`manual`,`workshop`); `recorded_by`; `recorded_at`; `updated_at`; unique (`offer_id`,`external_ref`) when ref not null | Usage source. Not append-only (state changes), but every change writes an audit event. Usage counts states `booked`, `held`, `no_show`. |
| `offer_score_criterion` | `key` PK; `label` not null; `position` int | No seed rows (source §6.2 not in repository). |
| `offer_score` | `id` PK; `offer_id`; `criterion_key` FK; `score` int not null within `OFFER_SCORE_MIN`..`OFFER_SCORE_MAX`; `status` text not null check `= 'hypothesis'`; `rationale`; `set_by`; `set_at` | Append-only history; current = latest per (offer, criterion). |
| `paid_engagement_type` | `key` PK (`sender_readiness_sprint`,`input_audit`,`resilience_review`); `name` not null; `weeks_min` int null; `weeks_max` int null; `scope_json` text not null (list of strings); `scope_confirmed` 0/1; `status` in (`active`,`inactive`); `lock_no` | **No price, fee, rate or currency column**; a schema test fails on any such name across this feature's tables. |
| `paid_engagement_deliverable` | `id` PK; `type_key` FK; `text` not null; `in_source` 0/1; `approval` in (`approved`,`pending_approval`,`rejected`); `approved_by` null; `decided_at` null | Deliverables with `in_source=1` are seeded approved. A new one has `in_source=0` and starts `pending_approval`; it cannot be used until approved by a holder of `paid_types.approve`. |

## Capabilities (`0019_capabilities.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `service_capability` | `id` PK (`capability-01`..`capability-19`); `slot` int unique 1..19; `name` null; `description` null; `input_types_json` null; `output_types_json` null; `buyer_problems_json` null; `limitations_json` null; `required_expertise` null; `potential_paid_type_key` null FK; `public_claim_status` in (`not_approved`,`approved`) default `not_approved`; `lock_no` | Null means "to be provided". `approved` needs: no null attribute, at least one `capability_evidence` row and an approved claim id in `public_claim_id`. |
| `capability_evidence` | `id` PK; `capability_id` FK; `basis_kind` in (`delivery_record`,`published_material`,`internal_assessment`); `reference` not null; `note`; `added_by`; `added_at` | Identifiers and short notes only (PHI guard). |
| `capability_delivery_example` | `id` PK; `capability_id` FK; `text` not null, max 800; `added_by`; `added_at` | Classified `internal_case_study_restricted`. Returned only with `capabilities.examples.read`; never in the public projection. |
| `capability_offer_link` | (`capability_id`,`offer_id`) PK | Visible from both sides. |

Added column on `service_capability`: `public_claim_id` text null FK to `claim`.

## State transitions

Offer version: `draft → internally_reviewed → approved → available`; `approved|available → withdrawn`; `approved|available → expired`. Gates on moving to `approved` or `available` (research R-04): no null required attribute, every active limitation validly acknowledged, no uncovered restricted phrase in public fields. A new version starts at `draft`; approving it moves `in_force_version_no` to it and the earlier version reads as superseded.

Claim: `draft → in_review → approved|rejected`; `approved|in_review|draft → withdrawn`; `needs_review` is computed. Editing the text of an `approved` claim is refused; a new claim is drafted instead.

Capacity period status (computed): `room` (used below limit), `exhausted` (used at or above limit), `no_limit_set`.

## Seed (`packages/db/src/seed/feature005.ts`, idempotent, all labelled hypothesis)

- Restricted phrase list version 1 (default rules, owner `campaign_approver` role, authored by `seed-author`, reviewed by `seed`).
- 10 offer heads and version 1 snapshots: Offers 1, 5, 6 with the facts in the guardrails (name, format, routing, SQL rule reference, paid-type link), other attributes null, status `approved` by actor `seed` with a note; Offers 2, 3, 4, 7, 8, 9, 10 key and null attributes, status `draft`; Offer 7 with its limitation; Offer 8 linked to Resilience Review.
- 3 paid engagement types and their in-source deliverables.
- 19 capability slots, all attributes null.
- Capacity limits (hypotheses): Offer 6 month 3, Offer 1 week 3.

## Events (identifiers only, strict schemas in `packages/domain/src/events/feature005.ts`)

| Type | Payload |
|---|---|
| `capability.updated` | `capability_id`, `change` (edit, evidence, link, public_status) |
| `offer.updated` | `offer_id`, `version_no`, `change` (version, status, limitation, score), `status` |
| `offer.capacity.changed` | `offer_id`, `period_kind`, `limit_sessions` |
| `claim.created` | `claim_id`, `effective_class` |
| `claim.reviewed` | `claim_id`, `decision`, `claim_status` |
| `claim.needs_review` | `claim_id` (emitted by the optional job) |

No claim, offer, note or example text appears in any event.

## Permissions (added to `packages/domain/src/rbac/permissions.ts`)

`capabilities.read`, `capabilities.edit`, `capabilities.examples.read`, `offers.read`, `offers.edit`, `offers.status.change`, `offers.limitations.acknowledge`, `offers.capacity.edit`, `offers.bookings.edit`, `claims.read`, `claims.draft`, `claims.approve` (restricted), `claims.phrases.manage`, `paid_types.edit`, `paid_types.approve` (restricted). Role mapping in research R-12.
