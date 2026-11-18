---
description: "Task list for Feature 003 — Signals and Evidence"
---

# Tasks: Signals and Evidence

**Input**: Design documents from `/specs/003-signals-evidence/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included and written first. Constitution Principle XVII forbids shipping automated behaviour without unit, contract and scenario tests. Every rule task is preceded by its test task, and the test must fail before the rule is implemented.

**Organization**: Setup → Foundational (taxonomy seed, schema, permissions, events) → one phase per user story in the requested order (validation and PHI guard → dedup → freshness → review and permissions → funding and regulatory rules) → APIs → Signal Feed UI → account timeline → audit/events/contract checks → end-to-end and polish. All paths are relative to `netspective-hde-gtm-engine/`.

## Format: `- [ ] T### [P?] [US#?] Description with file path`

- **[P]**: can run in parallel (different files, no unfinished dependency)
- **[US#]**: spec user story (US1 record with source and type, US2 full provenance, US3 excerpt limits, US4 dedup, US5 review and feed, US6 freshness, US7 funding context, US8 regulatory context)
- **Standard DoD** (applies to every task): lint, format and typecheck pass; the listed tests pass; no secret, PHI-like string or real data introduced (synthetic data only, `example.org`-style identifiers); every state change writes an audit event **in the same transaction**; no new column without a `COLUMN_CLASSIFICATION` entry; no excerpt or observation text in logs, audit or events (identifiers and rule IDs only).
- Constraint text quoted from [data-model.md](data-model.md) is verbatim. Numeric defaults (similarity 0.85, excerpt 300 characters, retention 36 months, per-type freshness windows A 365 / B 180 / C 180 / D 365 / E 120 / F 90 / G 180 / H 365 / I 90) are **hypotheses**, configurable, labelled `hypothesis` wherever stored or shown.
- Test files follow the existing layout of features 001 and 002 (domain tests beside `packages/domain`, integration and contract tests under `apps/api/test/`, DB tests under `packages/db/test/`).

## Progress notes (updated 2026-11-18)

**Done and verified** (full suite 567 tests including the 10,000-signal perf test, lint, typecheck and prettier clean): all of Phases 1–12 except T037, T062 and T068 below, and T067 (end-to-end over `signals.json` incl. the `lakeshore-hie` conflict).

**First-version deviations (record in open question #39):**
- T037 is partial: `SignalService.markStale` and `applyRetention` exist and are tested, but no worker queue is registered (`signals.freshness`, `signals.retention`) because the worker has no registered handlers yet in this version. Correctness does not need them (freshness and retention are applied at read time).
- T062 is partial: `SignalTimeline` is built and tested as a reusable component; it is not yet rendered on the account detail screen or inside the feed (feature 002's account screen is not built). The feed is already filterable by organisation.
- T011: there is no central audit action registry in the repository, so action names are strings in the services.
- T068: quickstart V1–V21 are covered by `signals-service.int.test.ts`, `signals-fixtures.int.test.ts`, the contract and RBAC tests and `apps/web/test/signals.test.tsx`; a manual run against a running stack is not done.
- Contact-clearing on erasure (T072) is implemented as `SignalService.clearContact(tx, contactId, actor)`; the 002 erasure flow (US7, not built) must call it.
- `signal_review` has an extra column `reliability_set` (a reviewer's reliability change, with a reason); not in the original data-model.
- A reviewer may pass `reliability` when recording; non-reviewers are refused (`signals.review` decides, `canOverrideReliability`).
- Retention default: citation-only sources use `retain_until = 9999-12-31` (kept as long as the account); other signals 36 months (hypothesis).

## Ordering notes (deviations from the requested order)

- The requested order is followed: taxonomy seed → schema → validation (incl. PHI guard) → dedup (test-first) → freshness → review + RBAC → APIs → Signal Feed → account timeline → end-to-end. The taxonomy **definitions** (pure data, T005) come before the migrations; the DB seed that loads them comes right after the schema (T012).
- Funding (US7) and regulatory (US8) rules are applied inside the recording path, so they are built after review and before the APIs; the API contract tests then cover them. Service-level integration tests make every story independently testable before any route exists.
- Priority labels: US1–US5 are P1, US6–US8 are P2. Freshness (US6) is placed before review (US5) as requested; "current evidence" is only complete once both exist (T045 composes them).
- Fixtures come first (T001), as in feature 002.
- Tasks added after `/speckit-analyze` (T072–T074) keep their numbers instead of renumbering the file; each sits in the phase where it runs.
- **Dependency on feature 002 (not yet fully built):** contact-to-account relationships (002 contact import and relationships) and contact erasure (002 US7). The contact clauses of T016, T019, T064 and T072 need them. If they are not ready, implement those clauses last; everything else in 003 is independent of them.
- The pure freshness rule (T032, T034) is implemented **before** `recordSignal` (T024) so no interim anchor is needed.

---

## Phase 1: Setup

- [x] T001 Add synthetic signal fixtures `tests/fixtures/synthetic-orgs/signals.json` for the existing organisations (no real data, `example.org` URLs): one signal per category A–I; a grant announcement and a budget-approval statement (category E); a CMS-0057-F item and an HTI-5 item (category H); an over-length excerpt; a "no storage" source signal; an undated source; one RFP on two portals sharing the notice number; an identical resubmission; a lightly reworded near-duplicate; and the two conflicting public signals of equal reliability for `lakeshore-hie.example` (SC-012). Document the file in `tests/fixtures/synthetic-orgs/README.md` and add expected outcomes to `expected.json`.
- [x] T002 [P] Add configuration with defaults labelled hypothesis in the existing config module `apps/api/src/config/` (and `.env.example`): `SIGNAL_EXCERPT_MAX_CHARS=300` (global hard ceiling), `SIGNAL_SIMILARITY_THRESHOLD=0.85`, `SIGNAL_RETENTION_MONTHS=36`, `SIGNAL_FRESHNESS_JOB_ENABLED=false`, `SIGNAL_RETENTION_JOB_ENABLED=false`; add config tests.
- [x] T003 [P] Create the module skeleton: `apps/api/src/modules/signals/{service,review,sources,queries,routes,events,index}.ts` (empty exports, public entry only) and `packages/domain/src/signals/index.ts`; extend the module-boundary lint rule so `packages/domain/src/signals/**` may not import provider, AI or database code.
- [x] T004 [P] Add the `SignalSubmission` Zod schema in `packages/ai-contracts/src/signal-extraction.ts` (account id, optional contact id, type key, source reference, observation, excerpt, dates, extraction method `manual|provider|ai_extracted`, extraction confidence `low|medium|high`, `ai_model` and `ai_prompt_version` required when `ai_extracted`, no reasoning-trace field) with a schema unit test.

**Checkpoint**: fixtures, config, skeleton and ingest schema exist.

---

## Phase 2: Foundational (taxonomy seed, schema, permissions, events)

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

### Taxonomy seed (pure)

- [x] T005 [P] Write the failing test then implement `packages/domain/src/signals/taxonomy.ts` with a test in `packages/domain/test/signals/taxonomy.test.ts`: categories A–I (A organisation/program, B interoperability, C operational data quality, D data platform/architecture, E procurement/funding, F hiring/capability gap, G executive/stakeholder change, H regulatory/ecosystem context, I first-party Netspective); the hypothesis seed types of the spec Assumptions (A organisation profile fact, program announcement; B multi-format sender observed, implementation-guide change, onboarding delay; C data quality issue, rejection volume; D platform or architecture change; E procurement notice (RFP), grant or funding announcement, budget-approval statement; F capability-gap hiring; G executive or stakeholder change; H regulatory or ecosystem item (CMS-0057-F, TEFCA, RHTP, implementation-guide change); I lead-magnet download, form submission, workshop or meeting note) each with `default_freshness_days`, `default_reliability`, `kind` (`general|funding|regulatory|first_party`) and `context_only`. Test: category `H` ⇔ kind `regulatory` (context-only), category `I` ⇔ kind `first_party`, every category has at least one active type, windows match the hypothesis values.

### Schema and persistence

- [x] T006 Write the failing migration test `packages/db/test/feature003-migrations.test.ts` (migrations 0011–0013 apply forward-only with valid checksums; every table and column is in `COLUMN_CLASSIFICATION`; **schema scan: no column name contains `funding_path`, `fit`, `hypothesis`, `intent`, `buyer_decision` or `recommendation`**; append-only triggers reject UPDATE and DELETE; **direct SQL** inserts are rejected for `buyer_confirmed` with a non-human or non-manual actor, for AI/system actors with `review_status <> 'pending'`, for `funding_class <> 'none'` on a non-funding type, for a regulatory type without `context_only = 1` and `reverify_required = 1`, and for `ai_extracted` without model and prompt version; immutable columns reject UPDATE).
- [x] T007 Create `packages/db/migrations-sqlite/0011_signal_taxonomy.sql`: `taxonomy_version` (`version` INTEGER PK; `status` `current|retired`; `released_at`; `approved_by`; `note`; `status_label` DEFAULT `hypothesis`; "Exactly one `current` row (partial unique index on `status` WHERE `status='current'`)"), `signal_type` (PK (`taxonomy_version`, `key`); `category` CHECK IN (`A`..`I`); `kind` `general|funding|regulatory|first_party`; `default_freshness_days` INTEGER CHECK > 0; `default_reliability` `high|medium|low|unknown`; `context_only` INT 0/1; "Kind `regulatory` ⇒ `context_only = 1` (CHECK); category `H` ⇔ kind `regulatory` (CHECK); category `I` ⇔ kind `first_party`; category `E` types may be `funding` or `general`"), `signal_source` (`name` UNIQUE NOT NULL; `kind` `official_publication|buyer_statement|third_party|analyst_observation|provider|first_party|other`; `storage_rule` `excerpt|citation_only` DEFAULT `citation_only`; `excerpt_max_chars` INTEGER NULL CHECK (NULL or ≥ 0); `availability` `available|unavailable` DEFAULT `available`; "CHECK: `storage_rule='citation_only'` ⇒ `excerpt_max_chars` IS NULL or 0"; never deleted).
- [x] T008 Create `packages/db/migrations-sqlite/0012_signals.sql`: `signal` with every column and CHECK from [data-model.md](data-model.md) — including "Source is mandatory: `source_id` NOT NULL and `source_ref` NOT NULL and length > 0 (FR-002)", `observation` NOT NULL and "length ≤ 1000", `excerpt` NULL when `excerpt_withheld_reason <> 'none'`, `excerpt` length ≤ 1000 hard cap, "`extraction_method = 'ai_extracted'` ⇒ `ai_model` and `ai_prompt_version` NOT NULL", "`evidence_status = 'buyer_confirmed'` ⇒ `extraction_method = 'manual'` and `created_by_type = 'human'`", "`funding_class = 'budget_approval_evidence'` ⇒ `approval_citation` NOT NULL", `sensitivity` never `prohibited`, UNIQUE (`account_id`, `type_key`, `content_fingerprint`), partial UNIQUE (`account_id`, `type_key`, `item_key`) WHERE `item_key IS NOT NULL`, and all the listed indexes (created here, including (`review_status`, `fresh_until`) and (`account_id`, `created_at`), so the 10,000-signal test in T044 needs no later migration); plus `signal_provenance` (UNIQUE (`signal_id`, `seq`), append-only, no free text), `signal_tag` (PK (`signal_id`, `dimension`, `value`); `icp` values ∈ {`icp1`,`icp2`}; capability and offer values 1–60 `[a-z0-9_]`), `signal_link` (UNIQUE (`signal_id`, `entity_type`, `entity_id`, `role`), append-only) and `evidence_artifact`. Triggers: `created_by_type IN ('ai','system')` ⇒ `review_status = 'pending'` at insert; `funding_class <> 'none'` only when the type's kind is `funding`; kind `regulatory` ⇒ `context_only = 1` and `reverify_required = 1` at insert; **immutable after insert**: `account_id`, `contact_id` (except to NULL on contact erasure), `type_key`, `taxonomy_version`, `source_id`, `source_ref`, `observation`, `excerpt`, `observed_at`, `collected_at`, `published_at`, `extraction_method`, `content_fingerprint` (exception: when `purged_at` is being set).
- [x] T009 Create `packages/db/migrations-sqlite/0013_signal_review.sql`: `signal_review` ("CHECK: `reject` ⇒ `reason` NOT NULL and length ≥ 3; `contradict` ⇒ `contradicts_signal_id` NOT NULL and ≠ `signal_id`; `reverify` ⇒ `reason` NOT NULL", append-only) and `signal_contradiction` ("CHECK `signal_a < signal_b` (sorted pair), UNIQUE (`signal_a`, `signal_b`). Only `resolved_*` may be updated, once").
- [x] T010 Register every new table and column in `packages/db/src/classification.ts` (business_contact / confidential_commercial / sensitive_operational_metadata per data-model); update the migration-list and seed-matrix tests that enumerate migrations; make T006 pass.
- [x] T011 [P] Add the new audit action names to the audit action registry: `signal.record`, `signal.merge`, `signal.review.approve`, `signal.review.reject`, `signal.review.contradict`, `signal.review.reverify`, `signal.review.clear_flag`, `signal.stale`, `signal.source.create`, `signal.source.update`, `signal.source.unavailable`, `signal.retention`, `signal.record.refused` and the `*.denied` variants.
- [x] T012 Seed taxonomy version 1 (`status='current'`) from T005 and default sources for each source kind in `packages/db/src/seed/feature003.ts`, all with `status_label = hypothesis`; register in the seed runner; extend seed tests (idempotent re-run, exactly one current version, default sources are `citation_only` unless explicitly given an excerpt limit).

### Permissions and events

- [x] T013 [P] Add permissions `signals.read`, `signals.record`, `signals.review` (restricted: humans only, SME reviewer + admin), `signals.sources.manage` (admin) in `packages/domain/src/rbac/permissions.ts` with the hypothesis role mapping (research analyst and GTM operator record; technical SME reviewer and administrator review; sales/service lead and read-only executive view); add `requireAnyPermission` to the authz module if missing; update the RBAC matrix and audit-coverage tests.
- [x] T014 [P] Add event payload schemas `signal.discovered` (`signal_id`, `account_id`, `type_key`, `merged`) and `signal.reviewed` (`signal_id`, `decision`, `review_status`) in `packages/domain/src/events/feature003.ts` with tests that no text field is possible; wire into `apps/api/src/modules/signals/events.ts`. (`signal.normalized` is intentionally not emitted — research R-13.)
- [x] T015 Add data-access helpers (`insertSignal`, `getSignal`, `listProvenance`, `appendProvenance`, `insertLink`, `insertReview`, `getSourceById/ByName`, `currentTaxonomy`) in `apps/api/src/modules/signals/repository.ts` behind `Tx`, with a repository integration test covering insert, immutability triggers and append-only triggers.

**Checkpoint**: schema, seed, permissions and events exist; user story work can begin.

---

## Phase 3: User Stories 1, 2 and 3 — Record with source, full provenance, excerpt limits (P1) 🎯 MVP

**Goal**: record a signal by hand or through the provider path with a mandatory source, a taxonomy type and version, all provenance fields, PHI guard on every text field, and excerpt/"no storage" limits.

**Independent Test**: quickstart V1–V8: record signals with and without source/type/account/contact; AI-extracted signal; over-length and no-storage excerpts; PHI-like text refused.

### Tests (write first, must fail)

- [x] T016 [P] [US1] Table-driven validation tests in `packages/domain/test/signals/validate.test.ts` (this task and T017 share the file, so write them in one sitting): missing source name or reference refused with the specific field; unknown/retired type refused; unknown account; contact without relationship to the account (needs 002 relationships, see Ordering notes); tags: `icp` values only `icp1`/`icp2`, capability and offer keys 1–60 characters of `[a-z0-9_]`, tags never change any other field; observation over 1000 characters refused; an observation that reads like a conclusion ("strong ICP fit", "they will buy") is accepted as plain observation and no output field expresses fit/intent; manual and provider submissions get identical results.
- [x] T017 [US2] Actor and status tests in `packages/domain/test/signals/validate.test.ts`: AI or provider actor cannot set `buyer_confirmed` or reliability override; only a human, manual entry from a `buyer_statement` source may be `buyer_confirmed`; `ai_extracted` requires model and prompt version; exactly one evidence status; AI/system actors always start `pending`; sensitivity `prohibited` refused.
- [x] T018 [P] [US3] Excerpt tests in `packages/domain/test/signals/excerpt.test.ts`: effective limit = the shorter of the global limit and the source limit; source limit longer than global is clamped; `citation_only` source stores no excerpt and gives reason `source_no_storage`; over-length gives `too_long`; within limit stored as given; boundary lengths (limit, limit+1).
- [x] T019 [US1] Integration tests `apps/api/test/signals-record.int.test.ts`: all of US1/US2/US3 acceptance scenarios through `recordSignal`, including PHI-like text in excerpt, observation, source ref and notes (refused whole, nothing stored, audit event carries rule IDs only, no echo in the error), taxonomy version stored on each signal, first-party category I accepted, provenance viewable with "not recorded" for missing optionals, supporting/contradictory lists always present (possibly empty), a credential-like string (synthetic API-key pattern) in any text field is refused like PHI-like text (FR-043). The contact-erasure case is tested in T072.

### Implementation

- [x] T020 [P] [US1] Implement `packages/domain/src/signals/normalise.ts`: observation normalisation (trim, collapse whitespace, Unicode NFKC, lowercase for fingerprinting only), `contentFingerprint(accountId, typeKey, observation)` = SHA-256 of `account | type | normalised text`, `canonicaliseSourceRef` (lowercase host, strip fragment and tracking parameters, trim trailing slash).
- [x] T021 [P] [US3] Implement `packages/domain/src/signals/excerpt.ts` per T018.
- [x] T022 [US1] Implement `packages/domain/src/signals/validate.ts` (`validateNewSignal`) per T016 and T017, returning typed refusal reasons (no PHI text in reasons).
- [x] T023 [P] [US2] Write the failing test `apps/api/test/signals-sources.int.test.ts` first, then implement source registry functions in `apps/api/src/modules/signals/sources.ts`: list/create/update sources (name unique; excerpt limit never above the global ceiling; `citation_only` ⇒ no limit), mark unavailable/available (one provenance entry per signal that cites the source, reliability untouched, audited as `signal.source.unavailable`), and creation of an **inline** source by a recorder as `citation_only` until an administrator allows excerpts (research R-09). The test includes the dead-URL edge case.
- [x] T024 [US1] Implement `recordSignal(tx, actor, input)` in `apps/api/src/modules/signals/service.ts`: authorise `signals.record`; run the PHI guard (`guardValue`) on every text field before any write; `validateNewSignal`; resolve the current taxonomy version, type defaults (freshness days, reliability), `fresh_until` via `freshUntil` from `freshness.ts` (T034, built first), **sensitivity** (`confidential_commercial` for buyer statements, provider and first-party sources and for any signal with a contact; `public` for official publications; `business_contact` when only a contact name/role is referenced; `internal_case_study_restricted` never assigned automatically; hypothesis defaults in a pure function `deriveSensitivity` with a unit test in T016's file) and **retention** (`retention_policy` = `business_record` with `retain_until` = collected date + `SIGNAL_RETENTION_MONTHS`; `citation_only` sources use `retention_policy = account_lifetime` and a `retain_until` equal to the account's lifetime, i.e. far-future until the account is erased); apply the excerpt rule; insert `signal`, tags, links and the first provenance entry (`first_recorded`); accept supporting/contradictory links only at recording time and through a `contradict` review (no separate add-link endpoint; the lists are always returned even when empty, FR-012); write audit (`signal.record`) and outbox `signal.discovered` in the same transaction; audit refusals (`signal.record.refused`) with rule IDs only. Make T019 pass.
- [x] T025 [US2] Implement provider/AI ingest `ingestSubmission(tx, actor, submission)` in `apps/api/src/modules/signals/service.ts`: validates against `SignalSubmission` (T004), forces `review_status = pending`, forbids `buyer_confirmed` and reliability override, then calls `recordSignal`. Rule for the REST path: a human caller may send `extraction_method = ai_extracted` only with model and prompt version, and `provider` is reserved for the ingest path (a human `provider` value is refused); add a fake-provider test in `apps/api/test/signals-ingest.int.test.ts` (provider independence, Principle XV).
- [x] T026 [US2] Implement the single-signal read model in `apps/api/src/modules/signals/queries.ts` (`getSignalDetail`): every provenance field of FR-007, the provenance chain, supporting and contradictory lists, definitions text for reliability and confidence, withheld-excerpt reason; include in T019.

**Checkpoint**: signals can be recorded and read with full provenance; US1, US2, US3 independently testable.

---

## Phase 4: User Story 4 — Near-duplicates merge with merged provenance (P1)

**Goal**: dedup is deterministic and idempotent; the same item from two sources is one signal counting as one independent source.

**Independent Test**: quickstart V9–V13: identical resubmission, reworded near-duplicate, RFP on two portals, separate observations, merge into an approved signal.

### Tests first

- [x] T027 [P] [US4] Similarity tests in `packages/domain/test/signals/similarity.test.ts` (trigram Sørensen–Dice over normalised observations: identical = 1, disjoint ≈ 0, symmetry, light rewording ≥ 0.85, different observation < 0.85).
- [x] T028 [P] [US4] Table-driven dedup tests in `packages/domain/test/signals/dedup.test.ts` for `decideDuplicate(new, candidates)` in this order: identical (same account, type and fingerprint) → `identical`; different source with same fingerprint or same `item_key` → `merge(republication)`; same account/type/source with similarity ≥ threshold → `merge(duplicate)`; otherwise `new`; idempotence (decision for an already-merged item is `identical`); the independent-source count counts distinct signals, never merged entries; similarity alone across different sources never merges; threshold is configurable.
- [x] T029 [US4] Integration tests `apps/api/test/signals-dedup.int.test.ts`: all US4 acceptance scenarios and SC-002/SC-003 — repeated identical submission creates 0 signals, 0 changes, no new audit/outbox rows beyond a no-op report; near-duplicate adds a provenance entry (who, when, method), keeps the original observed date, loses nothing; RFP on two portals is one signal with both sources and counts as one independent source; merge into an approved signal stays approved, observation unchanged, `new_provenance_flag = 1`, still counts as current evidence; concurrent identical submissions yield one signal (UNIQUE constraints).

### Implementation

- [x] T030 [P] [US4] Implement `packages/domain/src/signals/similarity.ts` and `packages/domain/src/signals/dedup.ts` per T027 and T028 (reuse the trigram helper from `packages/domain/src/accounts/similarity.ts` where it fits; no AI, no I/O).
- [x] T031 [US4] Integrate dedup into `recordSignal` in `apps/api/src/modules/signals/service.ts`: candidate lookup by (`account_id`, `type_key`) and `item_key`; `identical` returns the existing signal with `already_exists = true` and writes nothing; `merge` appends a provenance entry (`merged_duplicate` or `republication`), adds supporting source reference, sets `new_provenance_flag` when the target is approved, audits `signal.merge` and emits `signal.discovered` with `merged = true`, never updates immutable columns. Make T029 pass.

**Checkpoint**: US4 independently testable on top of US1–US3.

---

## Phase 5: User Story 6 — Freshness and current evidence (P2)

**Goal**: deterministic freshness per type; stale signals leave current evidence but stay viewable.

**Independent Test**: quickstart V14–V16: records of different types before and after the window; undated sources; repeatable evaluation.

### Tests first

- [x] T032 [P] [US6] Table-driven tests in `packages/domain/test/signals/freshness.test.ts`: `freshAnchor` (published date, else collected date, observed date for first-party types), `freshUntil = anchor + window days`, `isStale(now)` at the boundary (now = fresh_until is stale), undated flag and "never fresher than collected", per-type windows, determinism (same inputs and date twice), `isCurrentEvidence` = approved AND now < `fresh_until` AND not purged AND not rejected AND not in an undecided contradiction.
- [x] T033 [US6] Integration tests `apps/api/test/signals-freshness.int.test.ts`: all US6 acceptance scenarios using an injectable clock; `currentEvidence(tx, accountId, now)` excludes stale, rejected, contradictory-undecided, purged and **unreviewed** signals; stale signals remain in history; the optional job `signals.freshness` only materialises `freshness_state = 'stale'` and `signal.stale` audit, is idempotent, and correctness holds with the job disabled.

### Implementation

- [x] T034 [US6] Implement `packages/domain/src/signals/freshness.ts` per T032. **Build T032 and T034 before T024** (Phase 3 uses them).
- [x] T035 [US6] Confirm `recordSignal` sets `undated` when no published date and stores `freshness_days` and `fresh_until` using `freshness.ts`, covered by the undated test in T033.
- [x] T036 [US6] Implement `currentEvidence(tx, accountId, now)` and `isCurrent` flags in `apps/api/src/modules/signals/queries.ts`; the account id is first resolved to its surviving account (`merged_into`) and the query includes signals of every account merged into it, because `signal.account_id` is immutable (spec edge case "Account merged into another"); export from `apps/api/src/modules/signals/index.ts`.
- [ ] T037 [US6] Implement the optional freshness job body in `apps/api/src/modules/signals/service.ts` and register queue `signals.freshness` (daily, disabled by default via `SIGNAL_FRESHNESS_JOB_ENABLED`) in `apps/api/src/worker/`. Retention is T074.

**Checkpoint**: US6 independently testable (approval fixtures are inserted directly in tests until Phase 6).

---

## Phase 6: User Story 5 — Review workflow and permissions (P1)

**Goal**: SME reviewers and administrators approve, reject (with reason), mark contradictory, re-verify and clear flags; decisions are append-only and audited; unreviewed signals never count.

**Independent Test**: quickstart V17–V20 at service level: decisions, permission refusals, contradiction handling for `lakeshore-hie`.

### Tests first

- [x] T038 [P] [US5] Review rule tests in `packages/domain/test/signals/review.test.ts`: allowed transitions (`pending → approved | rejected | contradictory`; `approved → rejected | contradictory`; `rejected → approved`; `contradictory → approved | rejected`), reject needs a reason of ≥ 3 characters, contradict names a different signal, reverify needs a reason, `clear_flag` only when `new_provenance_flag = 1`, reviewers may review their own signals, AI/provider/system actors cannot review.
- [x] T039 [US5] Integration tests `apps/api/test/signals-review.int.test.ts`: all US5 review acceptance scenarios and SC-012 — approve leaves the observation unchanged and records who/when; reject without reason refused, with reason excluded from current evidence but kept; contradict links both signals (`signal_contradiction` pair, both `contradictory`, neither preferred, equal reliability, neither deleted); changed mind adds a new `signal_review` row and keeps earlier ones; reliability change by a reviewer requires a recorded reason; user without `signals.review` refused and audited (`*.denied`); PHI guard on reasons; `signal.reviewed` emitted with identifiers only; contradiction resolved when neither remains `contradictory`.

### Implementation

- [x] T040 [P] [US5] Implement review transition rules in `packages/domain/src/signals/review.ts` (pure) per T038.
- [x] T041 [US5] Implement `reviewSignal(tx, actor, signalId, decision)` in `apps/api/src/modules/signals/review.ts`: `requirePermission('signals.review')` (humans only), PHI guard on reasons, append `signal_review`, update `review_status`, maintain `signal_contradiction`, clear `new_provenance_flag` on `clear_flag`, append provenance entries (`reviewed`, `flag_cleared`), audit `signal.review.*`, emit `signal.reviewed`. Make T039 pass.
- [x] T042 [US5] Implement reliability override (reviewer only, reason required, `reliability_overridden_by` set) as part of `reviewSignal` and refuse it for AI/provider actors (SC-009); add to T039.
- [x] T043 [US5] Implement feed filter query `listSignals(tx, filters)` in `apps/api/src/modules/signals/queries.ts`: the organisation filter resolves merged accounts to the survivor as in T036; filters type, ICP tag, account (organisation), source, capability tag, offer tag, extraction confidence, freshness (`fresh|stale`), review status, singly or combined; newest first; keyset pagination; always returns review status, freshness and evidence status; integration test `apps/api/test/signals-feed.int.test.ts`.
- [x] T044 [US5] Add a performance test to `apps/api/test/signals-feed.int.test.ts`: with 10,000 generated synthetic signals every filter combination returns in under 2 seconds (SC-010); the indexes already exist from T008, so a failure means fixing the query (or amending 0012 before release), not adding a late migration.
- [x] T045 [US6] Compose and test "current evidence" end to end in `apps/api/test/signals-current-evidence.int.test.ts`: approved + fresh counts; pending, rejected, stale, contradictory-undecided and purged do not; a flagged approved signal counts; stale signals remain viewable in history (SC-004).

**Checkpoint**: US5 service behaviour and current evidence complete.

---

## Phase 7: User Story 7 — Funding context (P2)

**Goal**: funding signals default to funding context; budget-approval evidence only with a cited statement; nothing can express a funding path.

**Independent Test**: quickstart V21 (funding part): grant announcement, budget-approval statement with and without citation, hypothesis-only funding signal.

- [x] T046 [P] [US7] Table-driven tests in `packages/domain/test/signals/funding.test.ts`: `classifyFunding(type, input)` → `context` by default; `budget_approval_evidence` only for a funding-kind type with a non-empty `approval_citation` that is stated by the source; a grant announcement can never be `budget_approval_evidence`; non-funding types always `none`; derived/AI-hypothesis evidence status stays `context`.
- [x] T047 [US7] Write the failing integration tests first in `apps/api/test/signals-funding.int.test.ts` for all US7 acceptance scenarios, including SC-007 (the schema-scan test from T006 proves no funding-path column exists; assert API responses never contain a funding-path field); then implement `packages/domain/src/signals/funding.ts` per T046 and call it from `recordSignal`.

---

## Phase 8: User Story 8 — Regulatory context-only (P2)

**Goal**: regulatory signals are context-only with a re-verify flag; HTI-5 is never final; no compliance statements.

**Independent Test**: quickstart V21 (regulatory part): CMS-0057-F, TEFCA, RHTP and HTI-5 signals.

- [x] T048 [P] [US8] Table-driven tests in `packages/domain/test/signals/regulatory.test.ts`: category H always `context_only` and `reverify_required` at insert; statuses limited to `proposed|unverified|reported_final`; a signal naming HTI-5 can never be `reported_final` (refused with a specific reason); external-use check answers "not without re-verification" until re-verified; flag removable only by a `reverify` review; no output expresses compliance or non-compliance.
- [x] T049 [US8] Write the failing integration tests first in `apps/api/test/signals-regulatory.int.test.ts` for all US8 acceptance scenarios and SC-008 (HTI-5 never final, including via the review path); then implement `packages/domain/src/signals/regulatory.ts` per T048, call it from `recordSignal`, and wire the `reverify` decision in `reviewSignal` to clear `reverify_required` with a provenance entry (`reverified`).
- [x] T050 [US8] Add `externalUseAnswer(signal)` to `apps/api/src/modules/signals/queries.ts` and include it in the signal detail read model; test it.

---

## Phase 9: APIs (REST, contracts, RBAC)

**Goal**: expose the services through the two OpenAPI contracts with permission checks, idempotency, PHI guard and problem-detail errors.

- [x] T051 [P] [US1] Contract tests `apps/api/test/contract/signals.contract.test.ts` against `specs/003-signals-evidence/contracts/signals.openapi.yaml` (POST/GET `/signals`, GET `/signals/{id}`, POST `/signals/{id}/review`, GET `/accounts/{id}/signals`) using the existing `openapi-contract` helper; includes 201 vs 200 (`already_exists`), 400/401/403/404/422 problem bodies.
- [x] T052 [P] [US2] Contract tests `apps/api/test/contract/sources.openapi.contract.test.ts` against `specs/003-signals-evidence/contracts/sources.openapi.yaml` (GET `/signal-types`, GET/POST `/signal-sources`, PATCH `/signal-sources/{id}`, PUT `/signal-sources/{id}/availability`).
- [x] T053 [US1] Implement signal routes in `apps/api/src/modules/signals/routes.ts`: `POST /signals` (permission `signals.record`, `Idempotency-Key` via `runIdempotent`, PHI guard on the body), `GET /signals` (feed filters, `signals.read`), `GET /signals/{id}`, `GET /accounts/{id}/signals` (timeline, current-evidence flag; the account id resolves to the survivor and includes merged-away accounts as in T036), `POST /signals/{id}/review` (`signals.review`); register in `apps/api/src/app.ts`; contract and OpenAPI-registry tests pass.
- [x] T054 [US2] Implement source routes in `apps/api/src/modules/signals/routes.ts` (`signals.sources.manage` for create/update/availability, `signals.read` for lists); make T052 pass.
- [x] T055 [US5] RBAC route tests in `apps/api/test/signals-rbac.int.test.ts`: every role against every route (matrix from T013), refusals audited, AI/provider tokens cannot reach `review`, unauthenticated refused.
- [x] T056 [P] Extend the audit-coverage harness `apps/api/test/audit-coverage.int.test.ts` with drivers for every new mutating route so "state change ⇒ audit event in the same transaction" is proven for 003 (including refusals and PHI refusals with rule IDs only).

**Checkpoint**: APIs complete; the UI can be built against the contracts.

---

## Phase 10: Signal Feed UI (US5)

**Goal**: reviewers filter the feed and decide signals in under a minute.

- [x] T057 [P] [US5] Typed client `apps/web/src/lib/signals-api.ts` (list with filters, detail, review, sources, types) generated or hand-typed from the contracts, with error mapping; unit test.
- [x] T058 [P] [US5] Component tests (Testing Library) `apps/web/src/app/signals/signals.test.tsx` first: nine filters singly and combined; every row shows review status ("pending review" label for unreviewed), freshness (stale/undated flags), evidence status, "new provenance since review" flag, "re-verify before external use" flag for regulatory; reject requires a reason; contradict requires choosing the other signal; reviewers see the decision controls, other roles do not; PHI-warning component shown on text inputs; hypothesis labels on defaults.
- [x] T059 [US5] Build `apps/web/src/app/signals/page.tsx` (Signal Feed: filter bar, list with keyset "load more", signal detail drawer with full provenance chain and links, decision actions, side-by-side view for contradictory pairs, reliability and confidence definitions shown) and add the nav entry in `apps/web/src/components/nav.tsx` gated by `signals.read`; make T058 pass.
- [x] T060 [US1] Add a "Record signal" form to the feed page (source picker or inline new source, type from the current taxonomy, account, optional contact, observation, optional excerpt with the effective limit shown and an "excerpt will be withheld" warning); accessible labels and error messages; component tests.

---

## Phase 11: Account signal timeline (US2, US6)

**Goal**: the same evidence appears on the account view as a timeline.

- [x] T061 [P] [US6] Component tests `apps/web/src/components/SignalTimeline.test.tsx` first: chronological timeline, current vs stale vs pending clearly distinguished, provenance expandable, contradictory pair grouped, empty state, withheld-excerpt note with citation link.
- [ ] T062 [US6] Build `apps/web/src/components/SignalTimeline.tsx` as a reusable component using `GET /accounts/{id}/signals`, and render it in the Signal Feed's account view in `apps/web/src/app/signals/page.tsx` (selecting an organisation filter shows its timeline). Mounting it on the 002 account detail screen is a follow-up that belongs to feature 002's UI tasks and is not part of this task.

---

## Phase 12: Audit, events and contract checks

- [x] T063 [P] Outbox tests `apps/api/test/signals-events.int.test.ts`: `signal.discovered` on record and on merge (`merged` true), `signal.reviewed` on each decision, payloads contain identifiers only (no observation, excerpt or reason), no event for identical resubmission.
- [x] T064 [P] Privacy tests `apps/api/test/signals-privacy.int.test.ts`: captured logs, audit rows and error bodies contain no excerpt or observation text for refused PHI-like submissions; account merged into another (002) ⇒ signals follow the surviving account (reads resolve `merged_into`, see T036); contact erasure is tested in T072.
- [x] T065 [P] Compatibility test `apps/api/test/signals-evidence-compat.int.test.ts`: the 002 `evidence_reference` and the economic-buyer confirmation rule behave unchanged; a `signal_link` can point at an `evidence_reference` and an `icp_fit_assessment`; signals never alter any ICP assessment result (FR-011, FR-042).
- [x] T066 [P] Retention (T074) and taxonomy-change (T073) tests `apps/api/test/signals-taxonomy-retention.int.test.ts`: a new taxonomy version applies to new signals while old signals keep theirs; retired types refused for new signals but readable; retention expiry reduces a signal to a bare citation with an audit entry.

- [x] T072 Contact erasure hook: when a 002 contact is erased, set `signal.contact_id` to NULL (the only permitted update of that column) in the same transaction, append a provenance entry, and audit it; integration test `apps/api/test/signals-privacy.int.test.ts` shows the account-level observation remains. Depends on 002 erasure (see Ordering notes).
- [x] T073 Taxonomy publication (FR-004, spec edge case "Taxonomy changes"): implement an admin-only `publishTaxonomyVersion(tx, actor, types[])` in `apps/api/src/modules/signals/sources.ts` (permission `signals.sources.manage`; creates version N+1, marks N `retired`, keeps old signals on their version, retired types readable but refused for new signals, per-type freshness windows are changed only this way, audited `signal.source.update`-style action `signal.taxonomy.publish` added to T011); tested by T066. Listed here with the other cross-cutting tasks, but it can be done any time after T012.
- [x] T074 Retention (FR-015): implement `applyRetention(tx, now)` in `apps/api/src/modules/signals/service.ts` — signals past `retain_until` get `purged_at` set and observation/excerpt replaced by a removal marker, citation and provenance kept, audited `signal.retention`; it is applied lazily when a signal is read after expiry and by the optional queue `signals.retention` in `apps/api/src/worker/` (disabled by default via `SIGNAL_RETENTION_JOB_ENABLED`); tested in T066.

---

## Phase 13: End-to-end and polish

- [x] T067 End-to-end test `apps/api/test/e2e/signals-fixtures.e2e.test.ts` that imports `tests/fixtures/synthetic-orgs/signals.json` through the public API and asserts the outcomes in `expected.json`: one signal per category A–I stored with taxonomy version; grant announcement is funding context only; HTI-5 never final; regulatory signals context-only and re-verify flagged; over-length and no-storage excerpts withheld with a usable citation; identical resubmission creates nothing; reworded near-duplicate merges; the RFP on two portals is one signal counted as one source; **`lakeshore-hie` conflicting public signals of equal reliability are both kept, both `contradictory`, neither selected until a reviewer decides, and neither counts as current evidence while undecided (SC-012)**; stale signals leave current evidence; every state change and refusal has an audit event with no text content.
- [ ] T068 Run quickstart V1–V21 from [quickstart.md](quickstart.md) against a fresh database and fix gaps; record the results in the Progress notes at the top of this file.
- [x] T069 [P] Documentation: ADR-017 (signals as immutable observations with mutable review state, `fresh_until` + computed currency, `signal_link` naming) in `docs/adr/`, update `docs/context/05-open-questions.md` #35–#39 with decisions taken, and update the README feature list.
- [x] T070 [P] Coverage and boundary checks: `packages/domain` coverage stays ≥ 80%; boundary lint proves `packages/domain/src/signals` imports no provider/AI/DB code; the OpenAPI spec generated by the API matches both contract files.
- [x] T071 Full suite: `pnpm lint && pnpm typecheck && pnpm test` green, prettier clean, no PHI-like strings in new fixtures (run the fixture scan from feature 001).

---

## Dependencies & Execution Order

- **Phase 1** → **Phase 2** (blocks everything). Within Phase 2: T005 (pure taxonomy) → T006 (failing test) → T007–T009 (migrations) → T010 → T012; T011, T013, T014 are parallel; T015 after T010; T073 after T012.
- **Phase 3 (US1–US3)** depends on Phase 2 (and the pure freshness rule T032/T034) and is the MVP. **Phase 4 (US4)** depends on Phase 3 (`recordSignal`). **Phase 5 (US6)** depends on Phase 3 (T035 amends T024). **Phase 6 (US5)** depends on Phase 3; T045 depends on Phases 5 and 6. **Phases 7 and 8** depend on Phase 3 and, for the `reverify` path (T049), on Phase 6.
- **Phase 9 (APIs)** depends on Phases 3–8. **Phase 10 (feed UI)** depends on T053/T054. **Phase 11 (timeline)** depends on T053 and T036. **Phase 12** depends on Phases 3–9. **Phase 13** last.

### Parallel opportunities

- Phase 1: T002, T003, T004 together.
- Phase 2: T011, T013, T014 together after T010.
- Phase 3 tests: T016, T017, T018 together; implementation T020, T021, T023 together.
- Phase 4: T027, T028 together; Phase 5: T032 alone first; Phase 6: T038 then T040/T043/T044 together.
- Phases 7 and 8 can run in parallel with Phase 6 once Phase 3 is done (except T049's review wiring).
- Phase 9: T051 and T052 together; Phase 10: T057 and T058 together; Phase 12: T063–T066 together.

### Implementation strategy

- **MVP**: Phases 1–3 (record with source and type, full provenance, excerpt limits, PHI guard) — signals exist, are traceable and safe.
- **Increment 2**: Phase 4 (dedup) and Phase 6 (review) — the feed becomes usable and evidence can be vetted. Phase 5 adds currency.
- **Increment 3**: Phases 7–8 (funding and regulatory rules), then APIs (Phase 9), then the feed and timeline UI (Phases 10–11).
- **Finish**: Phases 12–13, ending with the `lakeshore-hie` end-to-end test (T067).
