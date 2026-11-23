# Data Model: Offer Routing and Lead Magnet

Persistence is the interim SQLite adapter behind `Tx` (ADR-015); migrations `0020_routing.sql`, `0021_engagement.sql`, `0022_intake.sql`. Identifiers are text (uuid v7) except seeded rows. Times are ISO-8601 UTC text. Every column is registered in `COLUMN_CLASSIFICATION`. **Append-only** tables have triggers that refuse UPDATE and DELETE; where only some columns may change, a guard trigger lists them.

## Routing (`0020_routing.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `routing_rule_set` | `version` int PK; `rules_json` text not null; `state` in (`draft`,`active`,`retired`); `author` not null; `reason` not null, min 3; `created_at`; `activated_by` null; `activated_at` null; `tests_passed_at` null | Rules never change after insert; only the state moves draft to active to retired. Partial unique index: at most one `active`. Version 1 is seeded `active` by actor `seed` (hypothesis). `tests_passed_at` is set when activation ran the case corpus. |
| `offer_recommendation` | `id` PK; `account_id` FK not null; `contact_id` FK null; `trigger` in (`operator`,`offer5_download`); `request_id` FK null; `rule_set_version` int not null FK; `outcome` in (`offer`,`research`,`no_action`); `offer_id` FK null (set when outcome is `offer`); `outreach` in (`allowed`,`blocked`); `blocked_reasons_json`; `eligible_json`; `excluded_json`; `matched_json`; `alternatives_json`; `ranking_json` null; `explanation` not null, max 600; `limitations_json`; `ai_invocation_id` null; `ai_fallback` 0/1; `inputs_hash` not null; `review_state` in (`pending`,`accepted`,`dismissed`) default `pending`; `reviewed_by` null; `reviewed_at` null; `review_reason` null; `created_by` null; `created_at` | Guard trigger: only the four review columns may change, and only once from `pending`. `offer_id` is not null when `outcome = 'offer'`. Out of date is computed at read from `inputs_hash`. |
| `offer_waitlist_entry` | `id` PK; `offer_id` FK; `account_id` FK; `contact_id` FK null; `reason` not null, min 3; `added_by`; `added_at`; `state` in (`waiting`,`released`,`removed`); `closed_by` null; `closed_at` null; `closed_reason` null | Only the state and closing columns may change, once. |

## Engagement (`0021_engagement.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `notice_version` | `id` PK; `version` int unique; `notice_text` not null, max 4000; `consent_text` not null, max 600; `created_by`; `created_at`; `approved_by` null; `approved_at` null | Text never changes after insert. Only `approved_by` and `approved_at` may be set, once, by someone other than the author. Only an approved version is served. Version 1 is **not** seeded: the wording comes from the marketing approver (open question #51), so until one is approved the form is unavailable and says so. |
| `consent_record` | `id` PK; `request_id` FK not null; `contact_id` FK null; `email_hash` not null; `notice_version_id` FK not null; `consent_given` 0/1; `recorded_at` | Append-only. Current permission for a person is the latest row for the contact or the hash. A withdrawal is a new row with `consent_given = 0`. |
| `offer_request` | `id` PK; `offer_id` FK; `form_slug` not null; `kind` in (`download`,`working_session`,`intake`); `state` in (`received`,`reviewed`,`linked`,`closed`); `email` text null; `email_hash` not null; `display_name` null; `role_title` null; `org_name` null; `org_type` null; `account_id` FK null; `contact_id` FK null; `flags_json` (array of `personal_email`, `org_type_differs`, `suppressed`, `no_consent`); `details_json` null (for a working session: at most five decisions, each at most 300 characters); `submitted_at`; `reviewed_by` null; `reviewed_at` null; `closed_reason` null | A flagged personal-email request keeps the email so a person can review it, classified as business contact data. Only the state, link and review columns change. A repeated submission inside the dedupe window creates no new row. |
| `lead_magnet_download` | `id` PK; `request_id` FK unique; `offer_id` FK; `account_id` FK null; `contact_id` FK null; `delivered` 0/1; `delivery_failure` null; `link_expires_at` null; `created_at` | Append-only. A fresh link is a new request and a new row. Counted as first-party engagement; never an intent or qualification record. |

## Intake (`0022_intake.sql`)

| Table | Columns (constraints) | Notes |
|---|---|---|
| `intake_submission` | `id` PK; `request_id` FK unique; `offer_id` FK; `kind` in (`offer_1`,`offer_6`); `schema_version` int; `account_id` FK null; `contact_id` FK null; `payload_json` not null, json valid; `classification` text not null check `= 'non_phi'`; `submitted_at`; `review_state` in (`pending`,`reviewed`) | Append-only apart from `review_state`. The payload is validated by the typed schema for the kind before insert. No column or key exists for credentials, production data, price or budget; a schema test scans for them. |

## Typed intake payloads (validated in `packages/domain/src/workshops/intake.ts`)

**Offer 1** (`schema_version` 1): `programType` (one of a fixed list), `organisationName`, `recentOnboarding` {`senderLabel` (a label, not a person), `formatAndGuide`, `timelineAndStages`}, `knownDelays` (list of up to 10 short texts), `attendingRoles` (list of up to 10 roles), `specsAvailable` (`yes`, `no`, `unsure`), `scrubbedRejectionLogsAvailable` (`yes`, `no`, `unsure`). Texts are limited to 500 characters.

**Offer 6** (`schema_version` 1): `useCase` (at most 200), `pilotOwner` (role or name, at most 120), `sourceSystems` (1 to 10 names), `fieldNames` (exactly 10, each passing `looksLikeFieldName`), `dataLead` (at most 120), `fieldQualityConcerns` (up to 10 short texts), `interfaceTypes` (up to 10 names), `attendees` (up to 10 roles).

**Working session**: `decisions` (1 to 5 entries, each at most 300 characters).

## State transitions

Recommendation review: `pending` to `accepted` or `dismissed` (once; dismissal needs a reason). Request: `received` to `reviewed`, `linked` or `closed`; `reviewed` to `linked` or `closed`. Rule set: `draft` to `active` to `retired`. Notice version: draft (unapproved) to approved. Wait-list entry: `waiting` to `released` or `removed`.

## Events (identifiers only, strict schemas in `packages/domain/src/events/feature006.ts`)

| Type | Payload |
|---|---|
| `offer.recommended` | `recommendation_id`, `account_id`, `outcome`, `outreach`, `rule_set_version` |
| `offer.requested` | `request_id`, `offer_id`, `kind` |
| `lead_magnet.downloaded` | `download_id`, `request_id`, `delivered` |

No email, name, role, explanation, decision text or link appears in any event.

## Permissions (added to `packages/domain/src/rbac/permissions.ts`)

`offers.recommend`, `requests.read`, `requests.review`, `waitlist.edit`, `routing.rules.manage` (restricted), `notices.manage`, `notices.approve` (restricted). Role mapping in research R-16.

## Seed (`packages/db/src/seed/feature006.ts`, idempotent, labelled hypothesis)

Routing rule set version 1 (research R-03), `active`, by actor `seed`. No notice version and no register file: both come from the business.
