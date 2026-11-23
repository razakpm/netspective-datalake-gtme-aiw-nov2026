# Data Model: Workshop Operations

Persistence is the interim SQLite adapter behind `Tx` (ADR-015); migrations `0023_workshops.sql` and `0024_workshop_findings.sql`. Identifiers are text (uuid v7). Times are ISO-8601 UTC text; `session_date` is the local calendar date in the business time zone. Every column is registered in `COLUMN_CLASSIFICATION`. **Append-only** tables have triggers that refuse UPDATE and DELETE; where only some columns may change, a guard trigger lists them.

## Workshop and lifecycle (`0023_workshops.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `workshop` | `id` PK; `request_id` FK `offer_request` not null; `offer_id` FK not null; `intake_id` FK `intake_submission` not null; `account_id` FK not null; `contact_id` FK not null; `state` in (`requested`,`booked`,`held`,`findings_recorded`,`closed`,`cancelled`,`no_show`); `duration_minutes` int 15 to 240; `scheduled_at` null; `session_date` null; `booking_id` FK `offer_session_booking` null; `booking_route` in (`manual`,`calendar`) null; `calendar_ref` null; `lock_no` int >= 1; `created_by`; `created_at`; `updated_at`; `closed_at` null | **Partial unique index** on (`request_id`) where `state` in (`requested`,`booked`,`held`,`findings_recorded`): one open workshop per request. `scheduled_at`, `session_date`, `booking_id` and `booking_route` are all null in `requested`, all set from `booked` on. `closed_at` is set on any final state. Guard: `offer_id`, `request_id`, `intake_id`, `account_id`, `contact_id`, `created_*` never change; a final state never changes. |
| `workshop_state_history` | `id` PK; `workshop_id` FK; `from_state` null; `to_state`; `note` null (min 3 when set); `scheduled_from` null; `scheduled_to` null; `changed_by`; `changed_at` | Append-only. A reschedule is a `booked` to `booked` row with both dates. `note` not null when `to_state` in (`cancelled`,`no_show`,`closed`) or the move is a reschedule. |
| `workshop_participant` | `id` PK; `workshop_id` FK; `side` in (`buyer`,`delivery`); `display_name` not null, max 120; `role_title` null, max 120; `contact_id` FK null; `user_id` null; `added_by`; `added_at`; `removed_at` null; `removed_by` null | Only the two `removed_*` columns may change, once. No email or phone column exists: contact details live on the contact. |
| `delivery_effort` | `id` PK; `workshop_id` FK; `prep_hours` real, 0 to 80; `session_hours` real, 0 to 24; `people` int 1 to 20; `recorded_by`; `recorded_at` | Append-only. The current entry is the latest row. |

## Artifacts and the brief

| Table | Columns (constraints) | Notes |
|---|---|---|
| `workshop_artifact` | `id` PK; `workshop_id` FK; `kind` text not null (checked against the configured list in code); `title` not null, max 200; `reference` null, max 500; `storage_key` null; `size_bytes` null; `content_sha256` null; `supplied_by_label` null, max 120; `recorded_by`; `recorded_at`; `classification` text not null check `= 'non_phi'`; `state` in (`received`,`held`,`released`,`discarded`); `quarantine_item_id` null; `hold_rule_ids_json` null; `decided_by` null; `decided_at` null; `file_deleted_at` null | Check: `reference` or `storage_key` is set. A held row has no `storage_key` and no `content_sha256` of the held content beyond the quarantine store's own. Guard: only `state`, `storage_key`, `size_bytes`, `content_sha256`, `quarantine_item_id` on release, `decided_*` and `file_deleted_at` may change; `held` moves only to `released` or `discarded`. |
| `workshop_brief` | `id` PK; `workshop_id` FK; `version_no` int >= 1; `content_json` not null json; `source` in (`baseline`,`model`); `ai_invocation_id` FK null; `model` null; `prompt_version` null; `created_by`; `created_at`; `unique (workshop_id, version_no)` | Append-only. The current brief is the highest version; earlier ones are superseded (computed). `ai_invocation_id` set only when `source = 'model'`. |

## Findings and outputs (`0024_workshop_findings.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `workshop_finding` | `id` PK; `workshop_id` FK; `version_no` int >= 1; `kind` in (`offer_1`,`offer_6`); `schema_version` int; `content_json` not null json; `state` in (`draft`,`finalised`); `waiver_reason` null (min 10 when set); `correction_reason` null (min 3; required when `version_no` > 1); `lock_no` int >= 1; `created_by`; `created_at`; `updated_at`; `finalised_by` null; `finalised_at` null; `classification` check `= 'non_phi'`; `unique (workshop_id, version_no)` | While `draft` the content may change (with `lock_no`). A trigger fixes every column of a `finalised` row. At most one `draft` per workshop (partial unique index). The kind equals the workshop's offer kind. |
| `workshop_output_document` | `id` PK; `workshop_id` FK; `finding_id` FK `workshop_finding` not null; `revision_no` int >= 1; `sections_json` not null json; `state` in (`draft`,`approved`); `edited_by`; `edited_at`; `approved_by` null; `approved_at` null; `pdf_storage_key` null; `pdf_sha256` null; `pdf_pages` int null; `file_deleted_at` null; `unique (workshop_id, revision_no)` | Each edit is a new `draft` revision (append-only). Approval sets the four `approved_*`/`pdf_*` columns once and fixes the row. Check: `state = 'approved'` implies `pdf_storage_key` not null and `pdf_pages = 1`. |
| `workshop_output_share` | `id` PK; `output_id` FK; `how` in (`handed_over`,`copied_link`,`other`); `note` null, max 300; `shared_by`; `shared_at` | Append-only. Only an `approved` output can be shared (service rule and trigger). |

## Typed content (validated in `packages/domain/src/workshops/`)

**Offer 1 findings** (`schema_version` 1): `flowSummary` (at most 1,000), `delaySources` (**at most 3**; each `description` at most 300, `ownerClass` one of `operator`, `sender`, `rule_owner`, `delay` either `{ kind: "quantified", amount > 0, unit: hours | days | weeks }` or `{ kind: "not_quantified" }`, `confirmation` one of `confirmed`, `not_confirmed`, `unknown` with `confirmedBy` and `confirmedAt` when not unknown), `unknowns` (up to 10 of at most 300), `suggestedNextStep` (at most 500), `boundaryNote` (at most 600, must begin with the standard boundary sentence).

**Offer 6 findings** (`schema_version` 1): `fields` (exactly the ten intake names in order, shown as changed when renamed with a reason; each `sourceSystem` and `sourceInterface` at most 120, `observations` with `quality`, `completeness`, `freshness`, `provenance`, `access`, each `{ status: known_good | gap | unknown, note at most 300 }`), `overall` (`view` go, no_go or conditional; `dependsOnUnknowns` up to 20 field and dimension pairs; `reason` at most 500), `disclaimer` (the fixed sentence, stored by value and compared on save), `inputAuditScope` (`useCase` at most 200; `sources` one or two of at most 120).

**Brief content** (`workshop-preparation-brief` 1.0.0): `confirmedFacts[{ statement ≤ 300, evidenceIds ≥ 1 }]`, `inferences[{ statement ≤ 300, basis ≤ 200 }]`, `unknowns[≤ 300]`, `suggestedQuestions[≤ 200]` (at most 12), `artifactChecklist[{ kind, why ≤ 200 }]`.

**Output sections**: `title`, `organisation`, `offerName`, `date`, `summary` (≤ 1,200), `findings` (≤ 1,200), `unknowns` (≤ 600), `nextStep` (≤ 500), `inScope` (1 to 8 items of ≤ 150), `outOfScope` (1 to 8 items of ≤ 150), `boundaryNote`, `disclaimer` (Offer 6 only, fixed). Total text at most `OUTPUT_MAX_CHARS`.

## State transitions

Workshop: see research R-02. Artifact: `received`; `held` to `released` or `discarded`. Finding: `draft` to `finalised` (a correction is a new version). Output: `draft` revisions to `approved` (fixed), then shared any number of times.

## Events (identifiers only, strict schemas in `packages/domain/src/events/feature007.ts`)

| Type | Payload |
|---|---|
| `workshop.requested` | `workshop_id`, `offer_id`, `request_id` |
| `workshop.booked` | `workshop_id`, `offer_id`, `reschedule` (boolean) |
| `workshop.held` | `workshop_id`, `offer_id` |
| `workshop.findings_recorded` | `workshop_id`, `offer_id`, `version_no`, `waived` (boolean) |

No name, note, finding, title, text, link or date appears in any event.

## Permissions (added to `packages/domain/src/rbac/permissions.ts`)

`workshops.read`, `workshops.edit`, `workshops.output.approve` (restricted). Mapping in research R-15. Releasing a held artifact uses the existing `quarantine.review`.

## Seed

None. The offers, capacity and bookings exist from feature 005. The artifact kinds, the boundary sentence, the disclaimer and the per-offer question lists are constants in the domain package (labelled hypotheses).
