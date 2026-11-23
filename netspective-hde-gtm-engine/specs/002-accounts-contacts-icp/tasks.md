---
description: "Task list for Feature 002 — Accounts, Contacts, Stakeholders and ICP Fit"
---

# Tasks: Accounts, Contacts, Stakeholders and ICP Fit

**Input**: Design documents from `/specs/002-accounts-contacts-icp/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included and written first. Constitution Principle XVII forbids shipping automated behaviour without unit, contract and scenario tests. Every rule task is preceded by its test task and the test must fail before the rule is implemented.

**Organization**: Setup → Foundational → one phase per user story in priority order (P1: US1, US2, US3, US4, US7; P2: US5, US6) → UI screens → audit, events and contract checks → end-to-end and polish. All paths are relative to `netspective-hde-gtm-engine/`.

## Format: `- [ ] T### [P?] [US#?] Description with file path`

- **[P]**: can run in parallel (different files, no unfinished dependency)
- **[US#]**: spec user story (US1 organisation import and duplicates, US2 contact import, US3 ICP fit explanation, US4 exclusion and override, US5 stakeholder roles, US6 ICP definitions, US7 suppression)
- **Standard DoD** (applies to every task): lint, format and typecheck pass; the listed tests pass; no secret, PHI-like string or real data introduced (synthetic data only, `example.org`-style identifiers); every state change writes an audit event **in the same transaction**; every new column is registered in `packages/db/src/classification.ts`; new config documented in `.env.example`; spec, contract and data-model text updated if behaviour changed; coverage stays ≥ 80% on `packages/domain` and `packages/ai-contracts`; the task is ticked `[X]` only after verification.
- Constraint text quoted from [data-model.md](data-model.md) is verbatim. Numeric defaults (similarity 0.80, 5 MB / 5,000 rows, bed band unset) are **hypotheses**, configurable and labelled as such wherever shown.

## Progress notes (updated 2026-11-17)

**Done and verified (full suite 462 tests, lint, typecheck, prettier clean):** Phase 1 (T001–T005), Phase 2 except T011, T014, T015, T019, T020, T021, T022, and all of Phase 3 / US1 (T023–T034). Quickstart V1–V6 are covered by `apps/api/test/accounts-import.int.test.ts` and `apps/api/test/contract/accounts.contract.test.ts`.

**First-version deviations (recorded in open question #34):**
- The import runs **inside the request** (one transaction, one savepoint per row) instead of as a queued job, so raw file content is never held in a job payload. Result: `201` with the completed run (the contract says so); `?dry_run=true` returns `200` and saves nothing; a replayed `Idempotency-Key` returns the stored run with `200`. A queued job is a later change (T017, T031).
- The PHI guard runs per row (the import routes opt out of the whole-body guard with `skipPhiGuard`) so a PHI-like row is rejected alone and the rest of the file is processed. There is no per-route policy registry in the guard, so no registration was needed (T016).
- Worker queue registration (`accounts.import`, `contacts.import`) is not needed until imports become jobs.
- T011 is partial: stakeholder roles and the configurable lists are seeded (`packages/db/src/seed/feature002.ts`); the default ICP definitions are seeded with US3 (T019).
- T015 is partial: event payload schemas exist (`packages/domain/src/events/feature002.ts`, `account.created` is emitted and tested); the other two events land with US2 and US3.
- T020 and T021 are partial: audit-coverage drivers and contract tests exist for the US1 routes only.
- Evidence recorded against an account that is later merged stays on the absorbed account id (evidence is append-only); the US3 assessment must read evidence for the survivor and its merged-away accounts.


## Ordering notes (deviations from the requested order)

- Fixtures are T001, as requested. Evidence recording (T022) is in Phase 2 although it is a US5 concept, because ICP criteria (US3) cite evidence references.
- US7 (suppression) precedes US5 and US6 because it is P1, and because US2's "suppressed contact stays suppressed on re-import" needs it. US2 depends on the suppression read function (T014 pure function) only, not on US7 routes.
- UI screens are grouped in Phase 10 after the APIs they call, labelled by story.
- Decisions already confirmed by the project owner (2026-11-16): `communication_preference` is not built; `weak` and `unknown` fit are not priority-eligible; only the four FR-026 fixtures have fixed ICP outcomes; the bed-count band stays unset (analyst-judgement route only).

---

## Phase 1: Setup (fixtures, configuration, permissions, contracts)

**Purpose**: Synthetic data first, then the small shared pieces every later task needs.

- [X] T001 Create the synthetic fixture set in `tests/fixtures/synthetic-orgs/{organisations.csv,organisations-invalid.csv,organisations-duplicates.csv,contacts.csv,contacts-invalid.csv,evidence.json,expected.json,README.md}`
  - Objective: all ten canonical fixtures from `docs/context/04-acceptance-scenarios.md`, as importable CSV plus expected-outcome manifest.
  - Data: the nine organisations `northvale-hie`, `prairie-medicaid-ops`, `riverbend-health`, `summitcare-health`, `helixbio`, `lakeshore-hie`, `metro-health-partners`, `coastal-hie`, `granite-health` (name, aliases, domains, type, geography, notes, optional `staffed_beds`) and the contact `pat.unsubscribed@example.org` (fixture 9), with at least one contact per organisation. `granite-health` carries a synthetic PHI-like pattern in `notes` (reuse a pattern from `tests/fixtures/phi-samples/prohibited.json`) so its row must be rejected. `evidence.json` holds evidence references with `topic` and `status` per organisation, including a `mid_size_judgement` record for `riverbend-health` and a `demonstrated_data_problem` record where a `strong` path is intended (e.g. `northvale-hie`: `sender_onboarding_friction` observed; `riverbend-health`: `stalled_ai_pilot` buyer_confirmed; `summitcare-health`: `generic_ai_interest` only, no `demonstrated_data_problem`). `organisations-duplicates.csv` holds a same-domain pair, a similar-name pair with matching type, a similar-name pair with differing type and geography (must NOT flag), and a shared-domain pair. `*-invalid.csv` hold wrong headers, missing source/basis, personal-mailbox email, unknown account, and an oversized-field case.
  - Constraints: only synthetic identifiers (`example.org`, `.example`, `.test`); `expected.json` fixes outcomes **only** for the four named in FR-026 (`helixbio` excluded; `northvale-hie` strong ICP 1; `riverbend-health` strong or possible ICP 2; `summitcare-health` possible ICP 2 with "no demonstrated data problem" unmet); every other fixture has `"expected_status": "pending-gtm-lead"` and must not be invented.
  - Accept: files parse; secret/PII scan and the fixture review pass; README states every record is fictional (Constitution "Data Handling").
  - Tests: T044 and T085 consume these files.
- [X] T002 [P] Add `SUPPRESSION_HASH_KEY` and import limits to `.env.example` and `apps/api/src/config.ts`
  - Constraints: key is an environment secret, never committed; production start-up fails if it is missing or shorter than 32 bytes; defaults `IMPORT_MAX_BYTES=5242880`, `IMPORT_MAX_ROWS=5000` (hypotheses, configurable).
  - Accept: config test covers missing key (fails in production, test default allowed in test mode) and limits parsing.
  - Tests: `apps/api/test/unit/config.test.ts` extended.
- [X] T003 [P] Add `IcpFitSuggestion` Zod schema in `packages/ai-contracts/src/icp-fit-suggestion.ts` with example fixtures and tests
  - Data: `suggestedStatus` (strong|possible|weak|excluded|unknown), `rationale` (≤ 500 chars, no chain-of-thought), `evidenceIds[]`, `confidenceBand` (low|medium|high), `model`, `promptVersion`, `reviewStatus`.
  - Constraints: Constitution X; export through the package index; JSON Schema export alongside.
  - Tests: valid and invalid examples; rationale length; unknown fields rejected.
- [X] T004 [P] Extend permissions and role mapping in `packages/domain/src/rbac/permissions.ts` and `packages/db/src/seed/reference.ts`; matrix tests in `packages/domain/test/rbac/feature002-matrix.test.ts`
  - Data: new permissions `accounts.read`, `accounts.import`, `accounts.edit`, `contacts.read`, `contacts.import`, `contacts.edit`, `contacts.erase`, `stakeholders.edit`, `evidence.record`, `review.decide`, `icp.read`, `icp.assess`, `icp.manage`, `icp.override`, `suppressions.lift`.
  - Constraints (research R-08, hypothesis): `accounts.read`/`contacts.read`/`icp.read` — gtm_operator, research_analyst, technical_sme_reviewer, sales_service_lead, read_only_executive, administrator; `accounts.import`/`accounts.edit`/`contacts.import`/`contacts.edit`/`review.decide` — gtm_operator, administrator; `stakeholders.edit`/`evidence.record` — sales_service_lead, gtm_operator, administrator; `icp.assess` — gtm_operator, research_analyst, administrator; `icp.manage`, `icp.override`, `suppressions.lift`, `contacts.erase` — administrator only and added to `isRestrictedPermission` (humans only). Adding a suppression needs no permission, only an authenticated active user; reading suppression history and the contact eligibility answer needs `contacts.read`. Foundation permissions unchanged.
  - Tests: every role × permission cell asserted; AI/system actors refused restricted permissions.
- [X] T005 [P] Record ADR-016 in `docs/adr/ADR-016-similarity-and-erasure-marker.md`
  - Content: in-code trigram similarity replaces `pg_trgm` under ADR-015 (Postgres prefilter later); keyed HMAC-SHA256 erasure marker; `communication_preference` out of scope; status Accepted (interim) with the open items from research.
  - Accept: ADR lists consequences and the retire condition.

**Checkpoint**: fixtures exist; permissions and config in place.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: Schema, classification, pure primitives, shared import infrastructure, module scaffolding. No user story starts before this phase completes.

- [X] T006 [P] Migration `packages/db/migrations-sqlite/0007_accounts.sql`
  - Tables `account`, `account_alias`, `account_domain`, `account_classification` exactly as in data-model.md, including `merged_into`, UNIQUE(`account_id`, `alias_normalised`), UNIQUE(`account_id`, `domain`), `org_type` CHECK list (`health_information_exchange`, `state_medicaid_program_operator`, `health_system`, `medtech`, `payer`, `multi_site_practice`, `biotech`, `other`, `unknown`), `staffed_bed_count` "INT NULL CHECK ≥ 0", and the indexes listed.
  - Constraints: `account_classification` append-only ("**Append-only history**") via BEFORE UPDATE/DELETE triggers; merged accounts cannot be edited (trigger); forward-only, checksummed.
  - Tests: `packages/db/test/migration-0007.test.ts` — apply from empty, constraint and trigger behaviour.
- [X] T007 [P] Migration `packages/db/migrations-sqlite/0008_contacts.sql`
  - Tables `contact`, `contact_source`, `stakeholder_role`, `account_contact_relationship`, `evidence_reference` (with `topic` CHECK list), `relationship_evidence`.
  - Constraints: `contact.business_email` UNIQUE NULL stored lower-case; `contact_source` and `evidence_reference` append-only; UNIQUE(`account_id`, `contact_id`) where `ended_at IS NULL`; trigger `acr_confirm_buyer` aborts setting `role_confirmed = 'economic_buyer'` or `authority_status = 'confirmed'` unless a linked `buyer_confirmed` evidence row exists via `relationship_evidence`; `evidence_reference.what` capped at 500 characters.
  - Tests: `packages/db/test/migration-0008.test.ts` including the trigger refusing a direct SQL update (no code path may bypass FR-033).
- [X] T008 [P] Migration `packages/db/migrations-sqlite/0009_icp.sql` (`icp_fit_assessment.basis` is NOT NULL and must be a non-empty JSON array, enforced by a CHECK on `json_array_length(basis) >= 1`)
  - Tables `icp_definition`, `icp_fit_assessment`, `icp_fit_ai_suggestion`, `exclusion_override`.
  - Constraints: UNIQUE(`icp`, `version`); partial UNIQUE index on (`icp`) WHERE `state='active'`; `rules` immutable after insert and only `draft→active`, `active→retired` transitions allowed (triggers); `icp_fit_assessment`, `exclusion_override` append-only; `exclusion_override.rationale` NOT NULL and "≥ 10 chars"; no intent column on assessments (FR-024).
  - Tests: `packages/db/test/migration-0009.test.ts`.
- [X] T009 [P] Migration `packages/db/migrations-sqlite/0010_suppression_review_imports.sql`
  - Tables `suppression_record`, `review_item`, `import_run`, `import_row`, `config_list`.
  - Constraints: `suppression_record` append-only with CHECK "scope `contact` ⇒ `contact_id` or `email_hash` set; scope `account` ⇒ `account_id` set"; `review_item` terminal states immutable; `import_row` PK (`import_run_id`, `row_number`) and **no row-content column**; `config_list` rows default `status_label = 'hypothesis'`.
  - Tests: `packages/db/test/migration-0010.test.ts`.
- [X] T010 Register every new table and column in `packages/db/src/classification.ts` (depends on T006–T009)
  - Constraints: contact `full_name`, `business_email`, `profile_url`, relationship `title_stated`, `department`, `contact_source.documented_origin` = `business_contact`; organisation, assessment, override and evidence data = `confidential_commercial`; ids, states, timestamps, hashes = `sensitive_operational_metadata`.
  - Accept: the existing classification test over the real schema passes with no unclassified column.
- [ ] T011 Seed reference data in `packages/db/src/seed/feature002.ts`: 20 `stakeholder_role` rows, `config_list` defaults, default ICP 1 and ICP 2 definitions (depends on T006–T009, T018)
  - Data: roles per FR-032; sources and bases per research R-16 (lists are "configurable" in this first version by editing the `config_list` table through a seed/config change made by an administrator; an edit UI/API is deferred, see open question #34); seeded personal mailbox domains (common consumer providers); definitions from `packages/domain/src/icp/defaults.ts` inserted as version 1, `state=active`, `status_label=hypothesis`.
  - Accept: seeding twice is a no-op.
  - Tests: seed idempotency test.
- [X] T012 [P] Organisation type list and normalisers in `packages/domain/src/accounts/{org-types,normalise}.ts` with tests
  - Constraints: excluded set is exactly `medtech`, `payer`, `multi_site_practice`, `biotech` (FR-027); domain normalisation lower-cases, strips scheme, path, `www.` and trailing dot and rejects non-hostnames; name normalisation lower-cases, strips punctuation and legal/organisational stop-words.
  - Tests: table-driven cases incl. IDN-like and malformed domains.
- [X] T013 [P] RFC 4180 CSV parser in `packages/domain/src/csv/parse.ts` with tests
  - Constraints: quoted fields, escaped quotes, CRLF/LF, optional UTF-8 BOM; whole-file rejects for missing/unknown headers, invalid UTF-8, unterminated quote, over `IMPORT_MAX_BYTES` or `IMPORT_MAX_ROWS`; cells trimmed; returns row numbers (1-based, header excluded) so reports map to the file.
  - Tests: property-style round-trip and fuzz cases; no cell content in thrown error messages.
- [X] T014 [P] Suppression primitives in `packages/domain/src/contacts/suppression.ts` with tests (pure part only) _(built in feature 006: `packages/domain/src/contacts/suppression.ts` has `suppressionStatus` and `keyedEmailHash`; account scope is checked through the subject's account, and the lift and erase-marker rules are covered; the relationship-based account lookup stays here)_
  - Data: `isSuppressed(records, {contactId, accountIds, emailHash})` returning `{suppressed, scope, reason}`; `hashEmail(key, email)` = HMAC-SHA256 over lower-cased trimmed email.
  - Constraints: account-scope suppression applies to every contact with an active relationship to that account; a later `lift` ends only the matching `add`; `erase_marker` matches by email hash; no I/O, no AI.
  - Tests: matrix over contact/account/lift/erase/multi-account cases (SC-009 inputs).
- [ ] T015 [P] Event types and audit action constants in `packages/domain/src/events/feature002.ts`
  - Data: `account.created`, `contact.identified`, `icp.fit_assessed` payload schemas (Zod, identifiers only — "no contact names or emails"); audit action names listed in data-model.md.
  - Tests: payload schema rejects extra personal fields.
- [X] T016 Module scaffolding (also register every new route, including the `text/csv` import routes, in the PHI guard policy resolver `packages/domain/src/privacy/policy.ts`, entry point `api_body`/`upload`, with a test that an unregistered route is rejected): fill `apps/api/src/modules/{accounts,contacts,icp}/index.ts`, register routes in `apps/api/src/app.ts`, add worker queue names in `apps/api/src/worker/registry.ts` wiring (depends on T004)
  - Constraints: each module exports only through `index.ts`; boundary lint enforced (no cross-module internals); queues `accounts.import` and `contacts.import`.
  - Tests: boundary-violation fixture still fails lint; app boots in the existing smoke test.
- [X] T017 Shared import-run infrastructure in `apps/api/src/platform/imports/{service,routes}.ts` with tests (depends on T009, T013, T016)
  - Objective: create `import_run`, hash the file (SHA-256, file never stored), enforce limits, support `dry_run`, enqueue the job with the run id as job key, expose `GET /api/v1/import-runs/{id}` per [accounts.openapi.yaml](contracts/accounts.openapi.yaml).
  - Constraints: whole-file rejection returns 422 with no run queued; the row report stores reason codes only; the HTTP `Idempotency-Key` header is required (001 mechanism) and a replay returns the original run; the PHI guard also inspects the whole-file text for file-level patterns before parsing; the import routes are registered in the guard policy resolver (T016) as `upload` entry points.
  - Tests: run lifecycle, replay, limits, dry-run saves nothing, report contains no cell content (assert against a canary string).
- [X] T018 Account repository (depends on T019 for `AccountSnapshot`) in `apps/api/src/modules/accounts/repository.ts` with tests (depends on T006)
  - Data: insert/update account, current classification (latest row), aliases with `current_until`, domains with shared flag, snapshot builder used by the evaluator (`AccountSnapshot`).
  - Constraints: every function takes a `Tx`; writes only through audited service functions (T031, T052).
  - Tests: unit tests on an in-memory database.
- [X] T019 [P] `AccountSnapshot` and assessment types in `packages/domain/src/icp/types.ts`, and the initial ICP 1 and ICP 2 definitions in `packages/domain/src/icp/defaults.ts` (status `hypothesis`, bed band unset); both are used by T011, T018 and T046 and must exist before them _(built in feature 006: `packages/domain/src/icp/{types,defaults,definition}.ts`; the account snapshot is read directly by the assessment service)_
- [ ] T020 Audit-coverage test extension in `apps/api/test/integration/audit-coverage.test.ts`: register every new route as a driver that must produce an audit event for its state change and for each refusal (depends on T016). Initially failing; turns green as stories land.
- [ ] T021 [P] Contract test harness for the five new contracts in `apps/api/test/contracts/feature002.contract.test.ts` using the existing `openapi-contract` helper (depends on T016). Initially pending per route; each story removes its `todo` markers.
- [ ] T022 Evidence reference service and `POST /api/v1/evidence` in `apps/api/src/modules/accounts/evidence.ts` with tests (the path is documented in `contracts/contacts.openapi.yaml` but implemented in the `accounts` module; to be tidied later, open question #34)
  - Constraints (data-model): `topic` from the controlled list; `what` ≤ 500 chars and PHI-guarded; append-only; requires `evidence.record`; status from the constitution's evidence-status enum; an AI actor cannot record `buyer_confirmed` (Constitution II).
  - Accept: matches `EvidenceInput` in [contacts.openapi.yaml](contracts/contacts.openapi.yaml); audited.
  - Tests: contract, permission, PHI, AI-actor refusal.

**Checkpoint**: schema, primitives, import infrastructure and evidence recording ready.

---

## Phase 3: User Story 1 — Import and de-duplicate organisations (P1) 🎯 MVP

**Goal**: operator imports organisations, reads a per-row report, duplicates are flagged and only a human merges; re-import is idempotent.

**Independent Test**: import `organisations.csv` and `organisations-duplicates.csv`, read the report, decide the merge candidates, re-import (quickstart V1–V6).

**Depends on**: Phase 2.

### Tests first

- [X] T023 [P] [US1] Similarity and candidate-rule tests in `packages/domain/test/accounts/{similarity,resolve}.test.ts`
  - Cases: exact normalised domain always flags unless domain is shared; name similarity ≥ 0.80 flags **only** when organisation type or geography also matches; name similarity alone never flags; shared domain alone never flags; renamed organisation matches its former alias; identical inputs give identical scores.
- [X] T024 [P] [US1] Account row validation tests in `packages/domain/test/accounts/validate-account-row.test.ts`: required name; fixed org-type list; hostname-valid domains; `staffed_beds` integer ≥ 0; unknown extra columns rejected at file level (T013); field length caps.
- [X] T025 [P] [US1] Import integration test in `apps/api/test/integration/accounts-import.test.ts`: valid + invalid rows (valid saved, invalid reported with reason code), idempotent re-import (every row `unchanged`, zero writes and zero audit events), PHI-like row rejected with `phi_guard:<rule_id>` and no content stored, merge-candidate flagging, shared-domain case, dry run saves nothing; no `account.merged_into` is ever set unless a `review_item` decision with a reason exists (SC-003).

### Implementation

- [X] T026 [US1] Implement `packages/domain/src/accounts/{similarity,resolve}.ts`
  - Constraints: trigram Sørensen–Dice, default threshold 0.80 (hypothesis, from config); pure; no I/O; no AI.
- [X] T027 [US1] Implement `packages/domain/src/accounts/validate-account-row.ts` (T024 passes)
- [X] T028 [US1] Account import service in `apps/api/src/modules/accounts/import.ts` (depends on T017, T018, T026, T027)
  - Objective: validate the whole file, then apply each valid row in its own transaction; outcomes `created|updated|unchanged|rejected|flagged`.
  - Constraints: matching by normalised domain and alias; unchanged rows write nothing (no audit, no timestamps); row PHI guard before any write (FR-018); rename keeps identity and adds the former name as an alias with `current_until` (FR-009); `staffed_beds` column appends an `account_classification` row only when changed; emits `account.created` through the outbox for new accounts; audit `accounts.import` per run and `account.update` per changed account.
- [X] T029 [US1] Review-item service for merge candidates in `apps/api/src/modules/accounts/review.ts`
  - Constraints: `pair_key` = sorted ids; `attribute_fingerprint` over domains, aliases, type, geography; a rejected pair is not re-proposed until the fingerprint changes (FR-006); terminal items immutable.
- [X] T030 [US1] Merge service in `apps/api/src/modules/accounts/merge.ts` (depends on T029)
  - Constraints: needs `review.decide`, a reason (3–500 chars) and a survivor; every name becomes an alias, every domain, relationship and note is kept; conflicting `org_type`, `geography`, `staffed_bed_count` require an explicit `fieldChoices` entry or the decision returns 400; absorbed account gets `merged_into` and stays readable; account-scope suppression on either account applies to the survivor; audited as `account.merge` with before/after summary (ids and field names only).
- [X] T031 [US1] Worker handler and routes: register `accounts.import` handler; `POST /api/v1/accounts/import` (`?dry_run=true`) in `apps/api/src/modules/accounts/routes.ts` per [accounts.openapi.yaml](contracts/accounts.openapi.yaml)
  - Constraints: requires `accounts.import`; `text/csv` body parser with `IMPORT_MAX_BYTES`; handler idempotent by job key (at-least-once safe, 001 rule).
- [X] T032 [US1] Read and edit routes: `GET /api/v1/accounts`, `GET /api/v1/accounts/{id}`, `PATCH /api/v1/accounts/{id}`, `PUT /api/v1/accounts/{id}/domains/{domain}/shared`
  - Constraints: list filters `orgType`, `fit`, `eligible`, `q`; cursor pagination; a PHI-like value in `name` or `notes` is refused by the guard (FR-050); `PATCH` of `staffedBedCount` is audited and **never** triggers an assessment (FR-040a); an organisation of type `unknown` can exist and shows fit `unknown`.
- [X] T033 [US1] Review queue routes for merge candidates: `GET /api/v1/review-items`, `GET /api/v1/review-items/{id}`, `POST /api/v1/review-items/{id}/decision` per [review.openapi.yaml](contracts/review.openapi.yaml) (contact-conflict handling lands in T040)
- [X] T034 [US1] Remove pending markers for US1 routes in T021 and T020; run quickstart V1–V6 against the fixtures.

**Checkpoint**: US1 independently demonstrable.

---

## Phase 4: User Story 2 — Import contacts with a lawful source (P1)

**Goal**: contacts enter only with source, basis and a business email, attached to an existing account.

**Independent Test**: import `contacts.csv` and `contacts-invalid.csv` (quickstart V7, V8).

**Depends on**: Phase 2, US1 (accounts exist), T014 (suppression primitives).

- [ ] T035 [P] [US2] Contact validation tests in `packages/domain/test/contacts/validate-contact.test.ts`: missing source, missing basis, source/basis not in the configured lists, personal mailbox domain (list from `config_list`), unknown account never guessed, malformed email, `profile_url` must be `https`, name+account identity when email absent.
- [ ] T036 [P] [US2] Contact import integration tests in `apps/api/test/integration/contacts-import.test.ts`: valid contact created and linked with source/basis stored; rejections carry reason codes; same business email re-imported creates no duplicate; differing title or account yields `conflict` and a `contact_conflict` review item with the stored record unchanged; suppressed contact remains suppressed after re-import; one person at two accounts has two relationships.
- [ ] T037 [US2] Implement `packages/domain/src/contacts/validate-contact.ts` (T035 passes)
- [ ] T038 [US2] Contact import service in `apps/api/src/modules/contacts/import.ts` (depends on T017, T037)
  - Constraints: identity by business email (lower-cased), else name + account (FR-015); `contact_source` row appended on creation and on any change of source/basis (FR-017); unchanged rows write nothing; row PHI guard first; relationships keep `title_stated` and `department` separate from roles; emits `contact.identified` (ids only) for new contact-account links; audit `contact.import`.
- [ ] T039 [US2] Worker handler and `POST /api/v1/contacts/import` (`?dry_run=true`) in `apps/api/src/modules/contacts/routes.ts`; requires `contacts.import`
- [ ] T040 [US2] Contact-conflict review decision in `apps/api/src/modules/contacts/conflicts.ts` and extend T033: `accept` applies the proposed values (new relationship/title) with audit `contact.conflict.resolve`; `reject` keeps the record; both need a reason
- [ ] T041 [US2] Read routes: `GET /api/v1/contacts` (filters `accountId`, `q`; suppressed contacts included and marked), `GET /api/v1/contacts/{id}` with source/basis history and relationships; requires `contacts.read`
- [ ] T042 [US2] Remove pending markers for US2 routes in T021 and T020; run quickstart V7–V8.

**Checkpoint**: US1 + US2 deliver accounts and lawful contacts.

---

## Phase 5: User Story 3 — See why an organisation fits (or not) an ICP (P1)

**Goal**: deterministic, explainable fit per ICP with met/unmet criteria, evidence, confidence and definition version; AI suggestion shown only as labelled advice.

**Independent Test**: assess every fixture; assert the four fixed outcomes; assert determinism (quickstart V9, V10).

**Depends on**: Phase 2 (evidence T022), US1 (accounts and bed count).

### Tests first

- [ ] T043 [P] [US3] Definition schema tests in `packages/domain/test/icp/definition.test.ts`: criteria kinds `account_type_in`, `account_attr_in_band`, `evidence_present`, `analyst_judgement`; at least one criterion; status rules must cover every outcome; an unevaluable definition is rejected (FR-039).
- [ ] T044 [P] [US3] Evaluator table-driven tests in `packages/domain/test/icp/evaluate.test.ts` over all fixtures in `tests/fixtures/synthetic-orgs` (test-first; must fail before T046)
  - Asserts: `helixbio` → `excluded` for both ICPs with the exclusion reason; `northvale-hie` → `strong` for ICP 1; `riverbend-health` → `strong` or `possible` for ICP 2; `summitcare-health` → `possible` for ICP 2 (named assertion: health-system type with only generic AI interest is `possible`, never `weak`) with "no demonstrated data problem" among **unmet** criteria; a known non-ICP, non-excluded type (e.g. an HIE assessed against ICP 2) → `weak`; type `unknown` → `unknown`; every assessment has a non-empty `basis`; organisation with no type → `unknown` with missing items listed; no bed count and no judgement → ICP 2 size criterion unmet and status not `strong`; judgement present → `possible`, never `strong`; contradictory evidence listed separately; the six unnamed fixtures only assert determinism and invariants (`pending-gtm-lead`); two runs give identical output and identical `inputsHash`; result object has no intent field.
- [ ] T045 [P] [US3] Assessment service integration tests in `apps/api/test/integration/icp-assess.test.ts`: history grows, never rewritten; assessment completes under the version it started with even if another version is activated meanwhile; AI suggestion stored beside the rule result and a differing suggestion never changes the stored status; `icp.fit_assessed` emitted with identifiers only; a later `contradictory` evidence record does not change an earlier assessment's cited evidence (evidence is append-only); an assessment with an empty `basis` is refused.

### Implementation

- [ ] T046 [US3] Implement `packages/domain/src/icp/{definition,evaluate}.ts` (T043, T044 pass)
  - Constraints: pure function `evaluate(account, evidence, definition)` returning `{status, confidence, basis[], met[], unmet[], missing[], contradictory[]}`; `basis` is never empty (account classification row, evidence ids, or `missing_info` items); status rules are the ordered first-match table in research R-06 (excluded → unknown → weak → strong → possible); confidence per R-06 (high only on `observed`/`buyer_confirmed` evidence); analyst judgement caps at `possible`; excluded types always `excluded`; no I/O; module must not import providers or ai-contracts (boundary lint, Constitution IX). `defaults.ts` is created in T019.
- [ ] T047 [US3] `inputsHash` helper in `packages/domain/src/icp/inputs-hash.ts` (account snapshot + evidence ids/status + definition id) with tests
- [ ] T048 [US3] Assessment service in `apps/api/src/modules/icp/assessments.ts` (depends on T018, T022, T046, T047) _(built in feature 006: a minimal `IcpService.assess` and `currentFit` exist in `apps/api/src/modules/icp/assessments.ts`; the definition-version freeze, AI suggestion and `icp.fit_assessed` event stay here)_
  - Constraints: reads the active definition once at start; loads current classification and evidence; inserts an append-only `icp_fit_assessment`; no intent data read; audit `icp.assess`; outbox `icp.fit_assessed`.
- [ ] T049 [US3] Routes `POST /api/v1/icp-fit-assessments`, `GET /api/v1/icp-fit-assessments?accountId=`, `GET /api/v1/icps` in `apps/api/src/modules/icp/routes.ts` per [icp.openapi.yaml](contracts/icp.openapi.yaml); `icp.assess` / `icp.read`
- [ ] T050 [US3] AI suggestion read path in `apps/api/src/modules/icp/suggestions.ts`: expose a stored `icp_fit_ai_suggestion` as `aiSuggestion` labelled `"AI-generated, advisory"`; never read by eligibility; nothing in this feature writes one (feature 004)
- [ ] T051 [US3] Remove pending markers for US3 routes in T021 and T020; run quickstart V9–V10.

**Checkpoint**: SC-001 and SC-008 demonstrable.

---

## Phase 6: User Story 4 — Excluded types stay out of the priority pipeline (P1)

**Goal**: exclusion enforced by rule; only an administrator can lift it, with a versioned override.

**Independent Test**: assess `helixbio`, refuse a non-admin override, grant and revoke as administrator (quickstart V11).

**Depends on**: US3.

- [ ] T052 [P] [US4] Eligibility tests in `packages/domain/test/icp/eligibility.test.ts`: `strong`/`possible` on at least one ICP is eligible; `weak` and `unknown` are not eligible; `excluded` is not eligible without an active grant; latest override row decides; grant never changes the stored assessment status. _(built in feature 006: the pure `priorityEligibility(fit)` exists in `packages/domain/src/icp/eligibility.ts`; the override grant and revoke rule stays here)_
- [ ] T053 [US4] Implement `packages/domain/src/icp/eligibility.ts` (pure)
- [ ] T054 [P] [US4] Override integration tests in `apps/api/test/integration/icp-override.test.ts`: non-admin refused and audited; grant needs rationale ≥ 10 chars (400 otherwise); a PHI-like rationale is refused; grant makes eligible and keeps the original exclusion visible; revoke is a further version; history immutable; AI/system actors refused.
- [ ] T055 [US4] Override service and `PUT /api/v1/accounts/{id}/exclusion-override` in `apps/api/src/modules/icp/overrides.ts`; requires `icp.override`; audit `icp.override.grant` / `icp.override.revoke`
- [ ] T056 [US4] Export `priorityEligibility(tx, accountId)` from `apps/api/src/modules/icp/index.ts` and use it for `GET /accounts` `eligible` filter and `priorityEligible` in account views (the single rule-based answer, FR-030)
- [ ] T057 [US4] Remove pending markers for override routes in T021/T020; run quickstart V11.

---

## Phase 7: User Story 7 — Record suppression immediately and everywhere (P1)

**Goal**: any user adds suppression on a contact or account; effective at once; follows the person; only an administrator lifts it.

**Independent Test**: suppress `pat.unsubscribed@example.org` and a whole account; check eligibility; re-import, merge, end a relationship (quickstart V14–V16).

**Depends on**: Phase 2 (T014), US1, US2.

- [ ] T058 [P] [US7] Suppression service integration tests in `apps/api/test/integration/suppression.test.ts`: contact scope, account scope covering later-added contacts, follows the person across two accounts, survives re-import, merge, role change and relationship end, no caching (suppress then check in the same transaction sees it), non-admin lift refused and audited, admin lift with reason keeps both rows in history, scenario F (unsubscribed contact excluded from any eligibility check regardless of other state).
- [ ] T059 [US7] Suppression service in `apps/api/src/modules/contacts/suppression.ts`: `addSuppression` (any authenticated active user), `liftSuppression` (`suppressions.lift`), history; `isContactSuppressed(tx, contactId)` exported from `apps/api/src/modules/contacts/index.ts` using T014 _(built in feature 006: `SuppressionService.add` and the single `checkSuppression` exist in `apps/api/src/modules/contacts/suppression.ts`; lifting, history and the routes stay here)_
  - Constraints: reason 3–500 chars; append-only; audit `suppression.add` / `suppression.lift`.
- [ ] T060 [US7] Routes `POST /api/v1/suppressions` (any authenticated active user; PHI-like reason refused), `GET /api/v1/suppressions` and `GET /api/v1/contacts/{id}/eligibility` (both `contacts.read`), `POST /api/v1/suppressions/{id}/lift` (`suppressions.lift`) per [suppressions.openapi.yaml](contracts/suppressions.openapi.yaml)
- [ ] T061 [US7] Erasure in `apps/api/src/modules/contacts/erasure.ts` and `DELETE /api/v1/contacts/{id}`; requires `contacts.erase`
  - Constraints (FR-049): set name, email, profile URL and relationship personal fields to NULL, set `erased_at`, append an `erase_marker` suppression row holding `hashEmail(SUPPRESSION_HASH_KEY, email)`, date and reason; later imports of that email are blocked by the marker; the audit event holds the contact id and a hash prefix only, never the erased values.
  - Tests: `apps/api/test/integration/contact-erasure.test.ts` including re-import blocked and no erased value in audit or logs (canary).
- [ ] T062 [US7] Wire suppression into account merge (T030) tests so SC-009 holds after a merge (the relationship-end case is asserted in T065 and T085); remove pending markers in T021/T020; run quickstart V14–V16.

---

## Phase 8: User Story 5 — Record stakeholder roles honestly (P2)

**Goal**: title, inferred role and confirmed role stored separately; economic buyer confirmed only with linked evidence.

**Independent Test**: set roles with and without evidence (quickstart V12, V16).

**Depends on**: Phase 2 (T007, T022), US2.

- [ ] T063 [P] [US5] Role rule tests in `packages/domain/test/contacts/roles.test.ts`: the fixed list of exactly 20 roles; confirming `economic_buyer` or `authority_status = confirmed` fails without ≥ 1 linked `buyer_confirmed` evidence; inferred role never reads as confirmed; title never populates confirmed fields; AI actor cannot confirm.
- [ ] T064 [US5] Implement `packages/domain/src/contacts/roles.ts` (T063 passes)
- [ ] T065 [P] [US5] Relationship integration tests in `apps/api/test/integration/relationships.test.ts`: separate storage of title/inferred/confirmed; 422 with nothing saved when evidence missing; evidence shown beside the confirmation; two accounts hold separate roles for one person; end relationship keeps history and ends active stakeholder status and a suppressed contact stays suppressed after the relationship ends (SC-009); a PHI-like value in any role/evidence free-text field is refused; the database trigger refuses a direct bypass.
- [ ] T066 [US5] Relationship service in `apps/api/src/modules/contacts/relationships.ts`: set roles with `evidenceIds`, end relationship (date + reason), `isBuyerConfirmed(tx, accountId)` answering only from confirmed roles; audit `relationship.role.change`, `relationship.end`; requires `stakeholders.edit`
- [ ] T067 [US5] Routes `PUT /api/v1/relationships/{id}/roles`, `POST /api/v1/relationships/{id}/end` per [contacts.openapi.yaml](contracts/contacts.openapi.yaml); remove pending markers in T021/T020; run quickstart V12, V16.

---

## Phase 9: User Story 6 — ICP definitions as versioned configuration (P2)

**Goal**: administrators create and activate definition versions; earlier assessments keep their version.

**Independent Test**: assess, edit, activate, re-fetch (quickstart V13).

**Depends on**: US3.

- [ ] T068 [P] [US6] Definition lifecycle integration tests in `apps/api/test/integration/icp-definitions.test.ts`: edit creates an inactive draft and the active version is unchanged; activation is a separate admin step that retires the previous active version atomically (one active per ICP); earlier assessments keep their version and result; non-admin refused and audited; invalid definition (no criteria, unevaluable status rule) rejected with reason (422) and not activatable; an assessment running during activation completes under its starting version.
- [ ] T069 [US6] Definition service in `apps/api/src/modules/icp/definitions.ts`: `createDraft`, `activate`, list; audit `icp.definition.create` / `icp.definition.activate`; requires `icp.manage`
- [ ] T070 [US6] Routes `POST /api/v1/icps`, `POST /api/v1/icps/{id}/activate` per [icp.openapi.yaml](contracts/icp.openapi.yaml); remove pending markers in T021/T020; run quickstart V13.

---

## Phase 10: UI screens (four minimal operator screens)

**Purpose**: screens over the APIs above. Each follows 001 session policy, nav and no-access handling, and shows a visible hypothesis label wherever definitions, thresholds or lists appear.

- [ ] T071 [P] [US1] API clients in `apps/web/src/lib/{accounts-api,contacts-api,icp-api,review-api,suppressions-api}.ts` with tests (server-side fetch through the existing proxy; no tokens in client code)
- [ ] T072 [US1] Account list screen `apps/web/src/app/(operator)/accounts/page.tsx`: filters (type, fit, eligible, text), import panel with dry-run preview and per-row report (reason codes; outcome counts), link to detail; hidden/blocked without `accounts.read`; tests in `apps/web/test/accounts-list.test.tsx`
- [ ] T073 [US3] Account detail screen `apps/web/src/app/(operator)/accounts/[id]/page.tsx`: profile, aliases and domains (shared flag), classification history, **ICP fit panel** (status per ICP, met/unmet, evidence, confidence, definition version, "AI-generated, advisory" suggestion when present, hypothesis label), override state with rationale (admin controls), contacts with roles, suppression control (any user add; admin lift); tests in `apps/web/test/account-detail.test.tsx`
- [ ] T074 [P] [US2] Contact list screen `apps/web/src/app/(operator)/contacts/page.tsx`: filter by account, suppressed marker, source/basis, import panel with report; tests in `apps/web/test/contacts-list.test.tsx`
- [ ] T075 [US1] Merge review queue `apps/web/src/app/(operator)/review/page.tsx`: open items for merge candidates and contact conflicts, both sides side by side, field choice for conflicts, required reason; approve/reject; tests in `apps/web/test/review-queue.test.tsx`
- [ ] T076 [US5] Stakeholder role editing on the account detail: title / inferred / confirmed shown separately, evidence picker for confirmation, clear failure message when evidence missing; tests in `apps/web/test/roles.test.tsx`
- [ ] T077 [US6] Administrator ICP definition view in `apps/web/src/app/admin/icps/page.tsx`: versions list, create draft from JSON, activate with confirmation; tests in `apps/web/test/icps-admin.test.tsx`
- [ ] T078 Navigation and permission gating for the new screens in `apps/web/src/components/nav` (reuse 001 policy), plus UI test that a user without the permission sees none of them

---

## Phase 11: Audit, events and contract checks

**Purpose**: prove cross-cutting guarantees across the whole feature.

- [ ] T079 Complete the audit-coverage test (T020): every state-changing route and every refused restricted action produces exactly one audit event; none contains contact personal values or content classified as prohibited (SC-011)
- [ ] T080 [P] Outbox event test `apps/api/test/integration/feature002-events.test.ts`: `account.created`, `contact.identified`, `icp.fit_assessed` present with identifier-only payloads (FR-048), dispatched at-least-once, handled idempotently by consumer
- [ ] T081 [P] Contract tests complete (T021): all routes in the five contracts validated; no pending markers remain
- [ ] T082 [P] Log-canary and PHI regression: extend the global log scan with contact-name and email canaries and a PHI-like CSV row; assert none appears in logs, audit, job errors or import reports
- [ ] T083 [P] OpenAPI drift check includes `specs/002-accounts-contacts-icp/contracts/*.yaml` (extend the existing check script/CI step)
- [ ] T084 [P] Classification and boundary tests: every new column classified; `packages/domain/src/{icp,accounts,contacts}` import neither providers nor ai-contracts; module boundaries hold

---

## Phase 12: End-to-end and polish

- [ ] T085 End-to-end test `tests/e2e/feature002-fixtures.test.ts`: start from an empty database, import every fixture organisation and contact, record the fixture evidence, assess all accounts, assert **only** the four fixed outcomes plus the invariants (`granite-health` rejected with no content stored; `pat.unsubscribed@example.org` suppressed; `helixbio` not priority-eligible; no organisation priority-eligible without an eligible fit or an active override); end a relationship for a suppressed contact and assert they stay suppressed; assert no account is merged without a human decision (SC-003); re-import all files and assert zero changes (SC-001, SC-002, SC-005, SC-007)
- [ ] T086 Execute quickstart scenarios V1–V19 against the running app and record results in `specs/002-accounts-contacts-icp/quickstart.md` (timings for SC-004 and SC-012 noted)
- [ ] T087 [P] Performance check: a 500-organisation file is imported and fully reported well inside 5 minutes (SC-004); results recorded in quickstart
- [ ] T088 [P] Documentation: update `docs/context/05-open-questions.md` statuses, add the Feature 002 section to `CLAUDE.md` module notes if needed, and document `SUPPRESSION_HASH_KEY` handling in `docs/runbooks`
- [ ] T089 Run `/speckit-analyze` for 002 (no CRITICAL findings), then the exit gate: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:contracts`; then `/speckit-converge` reporting Converged

---

## Dependencies and execution order

- **Phase 2 order fix**: T019 (types and default definitions) runs before T011 and T018 despite its number.

- Phase 1 → Phase 2 → stories. **T001 is first** and blocks T044, T085.
- Phase 2: T006–T009 [P]; T010 after T006–T009; T011 after T010 and T046's defaults (use a stub until then); T012–T015 [P]; T016 after T004; T017 after T009, T013, T016; T018 after T006; T022 after T007, T016.
- US1 → US2 → US3 → US4; US7 after US2; US5 after US2 and T022; US6 after US3. US3 and US7 are independent of each other after US2.
- UI (Phase 10) after the APIs each screen calls. Phase 11 after all stories. Phase 12 last.
- Within a story: tests (fail first) → domain rules → services → routes → pending-marker removal.

## Traceability (requirement → tasks)

| Requirements | Tasks |
|---|---|
| FR-001–FR-005, FR-007, FR-008, FR-010 (SC-002, SC-003) | T012, T013, T017, T023–T033 |
| FR-006, FR-009 | T029, T028 |
| FR-011–FR-018 (SC-005) | T007, T035–T042 |
| FR-019–FR-026 (SC-001, SC-008) | T001, T003, T043–T051 |
| FR-027–FR-030 (SC-007) | T052–T057 |
| FR-031–FR-035 (SC-006) | T007, T022, T063–T067 |
| FR-036–FR-040a (SC-010) | T043, T068–T070, T032 |
| FR-041–FR-045 (SC-009) | T014, T058–T062 |
| FR-046–FR-050 (SC-011) | T004, T015, T016, T020, T061, T079–T082 |

## Parallel examples

- Phase 2: T006, T007, T008, T009, T012, T013, T014, T015 together.
- US1 tests: T023, T024, T025 together; US2 tests: T035, T036; US3 tests: T043, T044, T045.
- After US2: US3 (T043–T051) and US7 (T058–T062) can proceed in parallel.
- UI: T071, T074 together; T072, T073, T075 after their APIs.

## Implementation strategy

- **MVP**: Phases 1–3 (US1) give a trusted account list with safe duplicate handling; add US2 and US7 next so contacts exist only with a lawful source and suppression is honoured, then US3 and US4 for fit and exclusion, then P2 stories.
- Stop at each checkpoint and run the full suite. Do not invent decisions: where a task needs one not in spec.md, plan.md or research.md (for example bed-band values, criteria wording for unnamed fixtures), stop and record it in `docs/context/05-open-questions.md`.
- Everything runs on interim SQLite (ADR-015); Postgres migrations, `pg_trgm` prefiltering and row locking remain deferred with the 001 list.
