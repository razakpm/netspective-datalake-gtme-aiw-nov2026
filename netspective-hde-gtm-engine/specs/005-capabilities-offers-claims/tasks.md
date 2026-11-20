---
description: "Task list for Feature 005 — Service Capabilities, Offer Catalog and Claims"
---

# Tasks: Service Capabilities, Offer Catalog and Claims

## Progress notes

- Phases 1 and 2 are done (T001 to T014). Typecheck, lint, format and the full unit and integration suites pass.
- Deviations: T003 created only the public entry points and `packages/domain/src/offers/types.ts` (the offer snapshot type, needed early by the seed); the other module files are created by the task that fills them, since empty files add nothing. The restricted phrase list version 1 is seeded by T021 together with the default rules, not by T011 (the rules do not exist yet). Shared helpers for refusals, permission checks and the PHI guard are in `apps/api/src/platform/catalogue.ts`; services check permissions themselves through `CatalogueActor.permissions`.
- The corpus rule ids (`ai-ready`, `sla`, `rto`, `rpo`, `sla-dotted`, `soc2`, `guarantee`, `guaranteed`, `guarantees`, `hipaa-compliant`, `production-ready`, `tenant-isolation`, `certified`, `outcome-percentage`, `case-study`, `customer-story`, `success-story`, `our-client`, `named-customer`) are the ids the default list in T021 must use.

**Input**: Design documents from `/specs/005-capabilities-offers-claims/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included and written first. Constitution Principle XVII forbids shipping automated behaviour without unit, contract and scenario tests. Every rule task is preceded by its test task, and the test must fail before the rule is implemented.

**Organization**: Setup → Foundational (schema, seed, events) → claim checker (test-first) → offer versioning, status and gate → capacity → capabilities, paid types and scores → approvals and RBAC → APIs → UI → scenario tests and polish. This is the requested order (seed data → schema → linter → versioning → capacity → approvals/RBAC → APIs → UI → tests), with one adjustment: the seed content and the checker corpus are defined first as fixtures, but the seed itself can only run after the schema exists, so schema comes before the seed code. All paths are relative to `netspective-hde-gtm-engine/`.

## Format: `- [ ] T### [P?] [US#?] Description with file path`

- **[P]**: can run in parallel (different files, no unfinished dependency)
- **[US#]**: spec user story (US1 claim governance and the linter, US2 offer catalogue and immutable versions, US3 capacity, US4 capability catalogue, US5 paid engagement types and scoring)
- **Standard DoD** (applies to every task): lint, format and typecheck pass; the listed tests pass; no secret, PHI-like string or real data introduced (synthetic data only, `.example` hosts); every state change writes an audit event **in the same transaction**; no new column without a `COLUMN_CLASSIFICATION` entry; no claim, offer, note, example or deliverable text in logs, audit or events (identifiers, codes and counts only); no model call anywhere (every rule in this feature is plain code).
- Constraint text quoted from [data-model.md](data-model.md) is verbatim. Numeric defaults (capacity limits 3 per month for Offer 6 and 3 per week for Offer 1, score scale 1 to 5, evidence expiry 12 months, time zone `UTC`) are **hypotheses**, configurable, tracked in open question #48.
- **A null content attribute means "to be provided"**; never write a sentinel string and never invent business content (CLAUDE.md rule; open question #47).
- Test files follow the layout of features 001–004 (domain tests under `packages/domain/test/`, integration under `apps/api/test/*.int.test.ts`, contracts under `apps/api/test/contract/`, DB tests under `packages/db/test/`, web tests under `apps/web/test/`).

## Path Conventions

Web application / modular monolith exactly as features 001–004: `apps/api`, `apps/web`, `packages/{domain,db,...}`. The stub folders `apps/api/src/modules/capabilities` and `apps/api/src/modules/offers` are filled in; `apps/api/src/modules/claims` is new (ADR-019).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration, permissions, module skeletons and the checker corpus.

- [x] T001 Add configuration `BUSINESS_TIME_ZONE` (default `UTC`, must be a valid IANA zone), `OFFER_SCORE_MIN` (default 1) and `OFFER_SCORE_MAX` (default 5, must be greater than min), `CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS` (default 12, integer 1 to 60) in `apps/api/src/config/index.ts` and `.env.example`, each labelled hypothesis; extend `apps/api/test/config.test.ts` with valid, default and invalid cases (bad zone, min ≥ max, non-integer months).
- [x] T002 [P] Add the 15 permissions `capabilities.read`, `capabilities.edit`, `capabilities.examples.read`, `offers.read`, `offers.edit`, `offers.status.change`, `offers.limitations.acknowledge`, `offers.capacity.edit`, `offers.bookings.edit`, `claims.read`, `claims.draft`, `claims.approve`, `claims.phrases.manage`, `paid_types.edit`, `paid_types.approve` in `packages/domain/src/rbac/permissions.ts`. Role mapping (hypothesis, research R-12): `sales_service_lead` gets capabilities read and edit, examples read, offers read, edit, status change, limitation acknowledgement, capacity edit, bookings edit, `paid_types.edit`, `claims.approve` and `paid_types.approve`; `campaign_approver` gets `claims.read`, `claims.draft`, `claims.approve`, `claims.phrases.manage`; analysts and operators read the catalogue and have `claims.draft`; the executive reads; administrator gets everything. Add `claims.approve` and `paid_types.approve` to the restricted (humans-only) set. Add descriptions in `packages/db/src/seed/reference.ts` and update the RBAC matrix, migration seed-matrix and `users-auth` contract tests that enumerate permissions (see how features 003 and 004 did it).
- [x] T003 [P] Create the module skeletons `apps/api/src/modules/claims/{repository,service,review,evidence,queries,routes,events,index}.ts`, `apps/api/src/modules/offers/{repository,service,status,limitations,capacity,bookings,scores,paid-types,routes,events}.ts` (keep the existing `index.ts`), `apps/api/src/modules/capabilities/{repository,service,projection,routes,events}.ts` (keep the existing `index.ts`), `packages/domain/src/{claims,offers}/index.ts` and `packages/domain/src/events/feature005.ts`, exported from `packages/domain/src/index.ts` (empty exports, public entry only). Confirm the boundary lint keeps `packages/domain/src/{claims,offers}` free of database, provider and HTTP imports and keeps `offers` and `capabilities` depending on `claims` only through its `index.ts` (never the reverse).
- [x] T004 [P] Create the checker corpus `tests/fixtures/claims/corpus.json`: an array of `{ id, text, expected: [{ class, rule, text, start, end }] }` entries, synthetic only. Positives cover all eight restricted classes (quantified outcome, production status, SLA or RTO, SOC 2 or certification, tenant isolation, legal or regulatory compliance, AI-ready, customer identity and case-study wording from the fixed set in FR-005 ("case study", "customer story", "success story", "our client", "named customer")), including "AI-ready", "AI ready", "AI‑ready" (non-breaking hyphen), "SLA", "S.L.A.", "RTO", "SOC 2", "SOC2", "guarantee", "guaranteed", "HIPAA compliant", "HIPAA-compliant", "production-ready", "multi-tenant isolation", "certified", "reduced rejections by 40%", "99.9% uptime". Negatives include "studying a customer segment", "slate", "translate the guide", "page 50%", "table of contents 3%", "readiness review for senders", and a clean paragraph. Add `tests/fixtures/claims/README.md` stating the corpus is the acceptance test for SC-001 and must only grow.

---

## Phase 2: Foundational (Schema, Seed, Events)

**Purpose**: Tables, immutability triggers, classification, seed and event schemas. **No user story work starts before this phase is complete.**

- [x] T005 [P] Write the failing migration test `packages/db/test/feature005-migrations.test.ts`: migrations `0017`–`0019` apply forward-only with valid checksums; every table and column is in `COLUMN_CLASSIFICATION`; a schema scan fails if any column on any table of this feature is named like `price`, `fee`, `rate`, `cost`, `amount` or `currency`; append-only triggers reject UPDATE and DELETE on `restricted_phrase_list`, `claim_review`, `lint_disposition`, `offer_version`, `offer_version_status`, `offer_limitation_ack`, `offer_capacity`, `offer_score`; CHECKs: `offer_score.status` "check `= 'hypothesis'`", `claim.text` "not null, max 600", `claim.status` in (`draft`,`in_review`,`approved`,`rejected`,`withdrawn`) (no `needs_review` column value), `claim_review` "Unique (`claim_id`,`reviewer_id`,`decision`)" and "note not null, min 3", `restricted_phrase_list` "`reviewed_by` must differ from `created_by`", `capability_delivery_example.text` "not null, max 800", `engagement_offer.number` "unique 1..10", `service_capability.slot` "unique 1..19", `offer_session_booking` "unique (`offer_id`,`external_ref`) when ref not null", `offer_capacity.limit_sessions` "0 or more", `paid_engagement_deliverable` approval in (`approved`,`pending_approval`,`rejected`).
- [x] T006 [P] Create `packages/db/migrations-sqlite/0017_claims.sql` with `restricted_phrase_list`, `claim`, `claim_evidence`, `claim_review` and `lint_disposition` exactly as in data-model.md "Claims" (columns, CHECKs, uniqueness, append-only triggers; evidence is withdrawn by setting `withdrawn_*` once, never deleted; `needs_review` is computed at read and has no column).
- [x] T007 [P] Create `packages/db/migrations-sqlite/0018_offers.sql` with `engagement_offer` (head: `latest_version_no`, `in_force_version_no` null, `lock_no`), `offer_version`, `offer_version_status`, `offer_limitation`, `offer_limitation_ack`, `offer_capacity`, `offer_session_booking`, `offer_score_criterion`, `offer_score`, `paid_engagement_type` and `paid_engagement_deliverable` exactly as in data-model.md "Offers". "**No price, fee, rate or currency column**" on any table; `offer_version_status.changed_by` accepts a user id or the literal `seed`.
- [x] T008 Create `packages/db/migrations-sqlite/0019_capabilities.sql` with `service_capability` (19 slots, null attributes, `public_claim_status` default `not_approved`, `public_claim_id` FK to `claim`), `capability_evidence`, `capability_delivery_example` and `capability_offer_link` exactly as in data-model.md "Capabilities". Depends on T006 for the `claim` table.
- [x] T009 Register every new table and column in `packages/db/src/classification.ts` (delivery example text as `internal_case_study_restricted`; offer and claim text as `confidential_commercial`; identifiers and timestamps as `sensitive_operational_metadata`); update the migration-list test `packages/db/test/migrations.int.test.ts`; make T005 pass.
- [x] T010 [P] Write the failing seed test `packages/db/test/feature005-seed.test.ts`: phrase list version 1 exists with an owner and a reviewer different from the author (version 1 is authored by `seed-author` and reviewed by `seed`); 10 offer heads (`offer-1`..`offer-10`) each with a version 1 snapshot; Offers 1, 5 and 6 carry the facts recorded in `docs/context/01-guardrails.md` (name, format, routing, SQL rule reference, paid-type link) with every other attribute null and an `approved` status row by actor `seed` with a note; Offers 2, 3, 4, 7, 8, 9, 10 have a key, null attributes and `draft`; Offer 7 has the limitation `evaluation_is_buyer_prompt_only` with wording "Evaluation is a buyer prompt only", active and with no acknowledgement; Offer 8 is linked to Resilience Review; three paid types (Sender Readiness Sprint 6 weeks 3 to 5 senders; Input Audit 6 to 8 weeks; Resilience Review inactive with `scope_confirmed` 0) with in-source deliverables `approved`; 19 capability slots `capability-01`..`capability-19` with every attribute null; no `offer_score_criterion` rows; capacity limits Offer 6 month 3 and Offer 1 week 3; running the seed twice changes nothing.
- [x] T011 Implement `packages/db/src/seed/feature005.ts` (idempotent; every estimate, limit and score labelled hypothesis; null for anything the repository does not record; read the facts from `docs/context/01-guardrails.md`, never invent attribute text) and run it from the seed entry in `packages/db/src/index.ts` after `feature004`; make T010 pass. Seeded approvals are written only through `offer_version_status` rows with `changed_by = 'seed'`.
- [x] T012 [P] Write the failing event schema test `packages/domain/test/events/feature005.test.ts`: strict schemas (unknown keys rejected) for `capability.updated` {`capability_id`, `change` in (edit, evidence, link, public_status)}, `offer.updated` {`offer_id`, `version_no`, `change` in (version, status, limitation, score), `status`}, `offer.capacity.changed` {`offer_id`, `period_kind`, `limit_sessions`}, `claim.created` {`claim_id`, `effective_class`}, `claim.reviewed` {`claim_id`, `decision`, `claim_status`}, `claim.needs_review` {`claim_id`}; a payload containing any text field is rejected.
- [x] T013 Implement `packages/domain/src/events/feature005.ts` and register the six event types; make T012 pass.
- [x] T014 Create the shared test harness `apps/api/test-support/catalogue-harness.ts` (in-memory database with all migrations and the feature 005 seed, fake clock, actors for service lead, two designated claim approvers, a drafter without approval rights, an analyst and an administrator, helpers to draft a claim with evidence, insert an approved claim, read outbox events and audit rows), modelled on `apps/api/test-support/research-harness.ts`.

**Checkpoint**: schema, seed and events exist and pass; user stories can begin.

---

## Phase 3: User Story 1 — Claim checker (Priority: P1) 🎯 MVP

**Goal**: A deterministic checker that flags restricted phrases in any text, with the versioned phrase list as data, plus the claims storage and read queries other features call.

**Independent Test**: Run the checker over `tests/fixtures/claims/corpus.json`; every restricted phrase is flagged with class, text and position and every clean sentence passes (SC-001). Quickstart V1, V2.

### Tests for User Story 1 (write first, must fail)

- [ ] T015 [P] [US1] Write `packages/domain/test/claims/normalise.test.ts`: NFKC, case folding, hyphen, en and em dash, non-breaking hyphen and non-breaking space unified to a single space or hyphen form, runs of spaces collapsed; the mapping from normalised offsets back to original offsets is exact (positions reported to callers point into the original text).
- [ ] T016 [P] [US1] Write `packages/domain/test/claims/linter.test.ts`: a table test that loads `tests/fixtures/claims/corpus.json` and requires every expected match (class, matched text, start, end) and no extra match; acronym rules are case-sensitive whole tokens ("SLA", "RTO", "RPO", "SOC 2", "SOC2"; "slate" and "translate" never match); a percentage flags only within five words of an outcome term (reduce, improve, increase, faster, uptime, save, cut); "page 50%" does not; overlapping rules do not double-report; input over 20,000 characters is bounded and runs in under 50 ms; `lintText` makes no call outside its arguments (pure).
- [ ] T017 [P] [US1] Write `packages/domain/test/claims/phrases.test.ts`: the default list validates against its schema (rules are one of `phrase`, `acronym`, `pattern`, `outcome_percentage`; each has an id and a restricted class); all eight restricted classes are represented; no two rules share an id; regex rules compile and cannot match the empty string.
- [ ] T018 [P] [US1] Write `packages/domain/test/claims/approval.test.ts` for the pure `evaluateClaimApproval`: effective class is the union of the declared class and any class the checker finds and is never lower than what is found; a restricted claim needs valid evidence and approvals from two different designated approvers who are not the drafter, and any reject stops it; a general claim needs valid evidence and one approval; the same reviewer's second approval does not count; evidence withdrawn or past `expires_at` is not valid; refusal codes `claim_needs_evidence`, `second_approver_required`, `drafter_cannot_approve`, `rejected`.
- [ ] T019 [P] [US1] Write `packages/domain/test/claims/cover.test.ts`: sentence splitting, `sentenceHash` (SHA-256 of the normalised sentence, injected hash function so the domain stays pure) and `coversSentence`: a flag is covered only when the whole sentence, after normalisation, equals the text of an approved, unexpired claim of the same class; substring matches do not cover; a false-positive disposition applies to that exact sentence hash and rule only.

### Implementation for User Story 1

- [ ] T020 [P] [US1] Implement `packages/domain/src/claims/types.ts` (restricted class union of the eight classes plus `general`, `PhraseRule`, `RestrictedPhraseList`, `LintMatch` {class, rule, start, end, text}) and `packages/domain/src/claims/normalise.ts`; make T015 pass.
- [ ] T021 [US1] Implement the default list in `packages/domain/src/claims/phrases.ts` (covers the eight classes, including "guarantee", "HIPAA compliant", "SOC 2", "AI-ready", SLA, RTO, "production-ready", "multi-tenant isolation", "certified", the fixed case-study wording set from FR-005 ("case study", "customer story", "success story", "our client", "named customer") and the outcome-percentage rule); make T017 pass.
- [ ] T022 [US1] Implement `lintText(text, list)` in `packages/domain/src/claims/linter.ts` (rule kinds phrase, acronym, pattern, outcome_percentage; bounded input; deterministic order by position); make T016 pass against the corpus.
- [ ] T023 [US1] Implement `evaluateClaimApproval` in `packages/domain/src/claims/approval.ts`; make T018 pass.
- [ ] T024 [US1] Implement `splitSentences`, `coversSentence` and the disposition match in `packages/domain/src/claims/cover.ts`; export all of `claims` from `packages/domain/src/claims/index.ts` and `packages/domain/src/index.ts`; make T019 pass.
- [ ] T025 [P] [US1] Write `apps/api/test/claims-repository.int.test.ts`: create a claim (text max 600, PHI guard refuses a synthetic SSN-like string and stores nothing), add evidence (expiry defaults to now plus `CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS`), the effective status reads `needs_review` when the only evidence is withdrawn or expired (computed at read, nothing stored), the cover lookup returns an approved unexpired claim for an exact sentence and none otherwise, `lintText` over the current phrase list version returns the same result as the pure function, and `claim` text of an `approved` claim cannot be edited.
- [ ] T026 [US1] Implement `apps/api/src/modules/claims/repository.ts` (claims, evidence, reviews, dispositions, phrase list versions; all writes inside one transaction with the audit event) and `apps/api/src/modules/claims/queries.ts` (effective status computed from evidence, `findCoveringClaim(sentence, class)`, `currentPhraseList()`, `lint(text)` that applies stored dispositions); export the public functions from `apps/api/src/modules/claims/index.ts` (`lintText` wrapper and claim lookup, for features 005 offers and 009); make T025 pass.

**Checkpoint**: the checker passes the full corpus and claims can be stored and looked up. Review writes (approve, reject, false positive) come in Phase 7.

---

## Phase 4: User Story 2 — Offer catalogue and immutable versions (Priority: P1)

**Goal**: The ten offers with immutable versions, per-version status, the gate on approval, and limitations that must be acknowledged (Offer 7).

**Independent Test**: Seed the catalogue, edit an offer, confirm a new version exists while the old one is unchanged, and try each allowed and refused status move. Quickstart V8 to V14, V27.

### Tests for User Story 2 (write first, must fail)

- [ ] T027 [P] [US2] Write `packages/domain/test/offers/status.test.ts` for the pure status machine: allowed moves "draft → internally_reviewed → approved → available; approved or available → withdrawn; approved or available → expired"; "No move out of withdrawn or expired"; every other pair refused with the code `invalid_transition` and a plain reason (draft straight to available is refused); `expired` is reached only by an explicit manual move, never by a date.
- [ ] T028 [P] [US2] Write `packages/domain/test/offers/gate.test.ts` for `evaluateOfferGate`: moving to `approved` or `available` is refused with `placeholder_attributes` (listing the null required fields), `limitation_unacknowledged` (an active limitation with no valid acknowledgement, where valid means the acknowledgement's wording hash equals the current wording hash), `uncovered_restricted_phrase` (a restricted flag in landing-page promise, call to action, buyer output or conversion path not covered by an approved claim and not dismissed); several refusals are returned together in a stable order; moves to `internally_reviewed`, `withdrawn` and `expired` have no gate beyond the transition order; the Netspective effort estimate always carries `estimate_status: "hypothesis"` (FR-015).
- [ ] T029 [P] [US2] Write `apps/api/test/offers-versioning.int.test.ts` (V8 to V11, V27): the seeded catalogue reads Offers 1, 5, 6 approved with the "baseline, attributes incomplete" notice and 2, 3, 4, 7, 8, 9, 10 draft; a change creates a new version at `draft` with `expectedVersion` checked against `lock_no` (a stale value returns `stale_version`); the earlier version and its `snapshot_hash` are unchanged after any number of later versions; the approved version stays `in_force_version_no` until the new one is approved, then reads as superseded (derived, not stored); direct UPDATE or DELETE on `offer_version` and `offer_version_status` is refused by the database; withdrawn and expired act on the in-force version and the capacity usage is kept.
- [ ] T030 [P] [US2] Write `apps/api/test/offers-limitations.int.test.ts` (V12, V13, V14): Offer 7 cannot move to `approved` while its limitation is unacknowledged (`limitation_unacknowledged`), succeeds past that gate after a service lead acknowledges (named in the record, recorded with who and when), changing the wording of an offer that is already approved leaves it in force but its read model carries `acknowledgement_stale`, and the next move to approved or available is refused until the limitation is acknowledged again; a caller without `offers.limitations.acknowledge` gets 403; an offer with null attributes is refused (`placeholder_attributes`); "SOC 2 certified" in a landing-page promise is refused (`uncovered_restricted_phrase`) until an approved claim covers that exact sentence; every refusal is audited with its code only.

### Implementation for User Story 2

- [ ] T031 [P] [US2] Implement `packages/domain/src/offers/types.ts` (`OfferSnapshot` fields: name, format, target ICP, buyer output, buyer effort, effort estimate with `estimate_status: "hypothesis"`, conversion path, landing-page promise, CTA, intake fields list, success hypotheses list, SQL rule reference, related capability keys, paid engagement type key; every content field nullable; the SQL rule reference is a non-empty string of at most 100 characters, otherwise refused), `packages/domain/src/offers/status.ts` and `packages/domain/src/offers/gate.ts`; export from `packages/domain/src/offers/index.ts`; make T027 and T028 pass.
- [ ] T032 [US2] Implement `apps/api/src/modules/offers/repository.ts` (head and version reads and writes; a new version writes the snapshot, its SHA-256 hash and an initial `draft` status row in one transaction) and the canonical JSON and hash helper in `apps/api/src/modules/offers/snapshot.ts` (stable key order so the hash is reproducible).
- [ ] T033 [US2] Implement `apps/api/src/modules/offers/service.ts`: `createVersion(actor, offerId, patch, { expectedVersion, reason })` (PHI guard on every free-text field, `lock_no` check, audit and `offer.updated` in the same transaction), read models for the catalogue, one offer, and the version list and a single version, including the "baseline, attributes incomplete" notice for versions whose only status row is by actor `seed` and that still hold nulls. Make T029 pass except the status parts.
- [ ] T034 [US2] Implement `apps/api/src/modules/offers/status.ts`: `moveStatus(actor, offerId, versionNo, to, note)` that runs the pure transition check, gathers the gate inputs (null fields, active limitations and their valid acknowledgements, the `claims` index `lint` and `findCoveringClaim` for the public fields), calls `evaluateOfferGate`, appends the `offer_version_status` row, moves `in_force_version_no` when a version reaches `approved`, and audits both success and refusal (codes only). Make T029 pass.
- [ ] T035 [US2] Implement `apps/api/src/modules/offers/limitations.ts`: add or change a limitation (a wording change keeps the hash check), `acknowledge(actor, limitationId)` (permission `offers.limitations.acknowledge`, appends `offer_limitation_ack` with the current wording hash), and the validity check used by the gate; make T030 pass.

**Checkpoint**: offers are versioned, immutable and gated; Offer 7 cannot be activated while its limitation is unacknowledged.

---

## Phase 5: User Story 3 — Capacity per offer and period (Priority: P2)

**Goal**: Limits per offer and period with history, usage computed from bookings, and an "exhausted" answer other features can query.

**Independent Test**: Set Offer 6 to 3 per month, book 3 sessions, the status is `exhausted`; cancel one and it returns to `room`; no limit reads `no_limit_set`. Quickstart V15 to V19.

### Tests for User Story 3 (write first, must fail)

- [ ] T036 [P] [US3] Write `packages/domain/test/offers/period.test.ts` for `periodFor(date, kind, timeZone)`: calendar week from Monday and calendar month in the business time zone; month-end and week-end edges; dates just before and after midnight in a non-UTC zone; daylight-saving changes (a spring-forward and a fall-back week); invalid zone rejected.
- [ ] T037 [P] [US3] Write `packages/domain/test/offers/capacity.test.ts` for `usage` and `status`: usage counts states `booked`, `held` and `no_show`; `cancelled` is released; held count reported separately; status `room` when used is below the limit, `exhausted` when used is at or above it, `no_limit_set` when no limit exists (never "unlimited"); limit history picks the row with the latest `effective_from` not after the period start; a limit of 0 reads `exhausted`.
- [ ] T038 [P] [US3] Write `apps/api/test/offers-capacity.int.test.ts` (V15 to V19): set and change a limit (previous value, who and when kept, `offer.capacity.changed` emitted); `recordBooking` into a full period is refused `capacity_exhausted`; `rescheduleBooking` releases the first period and counts the second, and is refused when the second is full; `cancelBooking` returns the status to `room`; a no-show still counts; `external_ref` is unique per offer; manual bookings are labelled `source = 'manual'`; `capacityStatus(offerId, at)` returns state, limit, used, held, remaining, utilisation and period bounds and matches the recorded data in every case (SC-005); withdrawn or expired offers keep their usage and report not available; a caller without `offers.capacity.edit` or `offers.bookings.edit` gets 403.
- [ ] T039 [P] [US3] Write `apps/api/test/offers-capacity-perf.int.test.ts`: `capacityStatus` for one offer returns in under 200 ms with 1,000 synthetic bookings.

### Implementation for User Story 3

- [ ] T040 [P] [US3] Implement `packages/domain/src/offers/period.ts` (`Intl.DateTimeFormat` based, no new dependency) and `packages/domain/src/offers/capacity.ts`; export from `packages/domain/src/offers/index.ts`; make T036 and T037 pass.
- [ ] T041 [US3] Implement `apps/api/src/modules/offers/bookings.ts` (`recordBooking`, `rescheduleBooking`, `cancelBooking`, `markNoShow`, each in one transaction that re-checks the period's usage before writing, with an audit record and no event, since bookings carry no event in the plan) and `apps/api/src/modules/offers/capacity.ts` (`setLimit` with history and `offer.capacity.changed`, `capacityStatus`, `utilisation`); export `capacityStatus`, `recordBooking`, `rescheduleBooking` and `cancelBooking` from `apps/api/src/modules/offers/index.ts` (the public functions features 006 and 007 call); make T038 and T039 pass.

**Checkpoint**: Feature 006 can ask whether an offer is exhausted in one call.

---

## Phase 6: User Stories 4 and 5 — Capabilities, paid engagement types and scores (Priority: P2 and P3)

**Goal**: The 19 capability slots with internal-only delivery examples and a public projection; the three paid engagement types with no price and approved deliverables only; offer scores labelled hypothesis.

**Independent Test**: Read 19 capability slots with placeholders marked; the public projection never contains example text; the paid types have no price field; a new deliverable stays pending. Quickstart V20 to V25.

### Tests (write first, must fail)

- [ ] T042 [P] [US4] Write `apps/api/test/capabilities-projection.test.ts`: a property-style test over generated capabilities with delivery examples proving the public projection never contains any example text and never any field classified `internal_case_study_restricted`; the list response omits examples for a caller without `capabilities.examples.read`.
- [ ] T043 [P] [US4] Write `apps/api/test/capabilities.int.test.ts` (V23 to V25): 19 slots seeded with every attribute null and shown as "to be provided"; edit with `lockNo` (stale returns `stale_version`); evidence basis and delivery examples (text max 800, PHI guard refuses and stores nothing); links to offers and a paid type visible from both sides; marking a capability `approved` for public claims is refused with `placeholder_attributes` when any attribute is null and `no_evidence_basis` when no evidence exists and when no approved claim is linked (`public_claim_id`); examples are returned only with `capabilities.examples.read`.
- [ ] T044 [P] [US5] Write `apps/api/test/paid-types.int.test.ts` (V20, V21): three types with the stated scope, Resilience Review `inactive` with `scope_confirmed` 0; no price, fee, rate or currency field in any response schema; a new deliverable not in the source is stored with `in_source = 0` and `approval = 'pending_approval'`, cannot be used, and is approved or rejected only by a holder of `paid_types.approve` with the decision audited; PHI-like text refused whole; a request body carrying a `price`, `fee`, `rate` or `currency` key is rejected (strict request schema).
- [ ] T045 [P] [US5] Write `apps/api/test/offer-scores.int.test.ts` (V22): no criteria are seeded and the list is empty with a "to be provided" label; a score outside `OFFER_SCORE_MIN`..`OFFER_SCORE_MAX` is refused; every stored score has `status = 'hypothesis'` and is labelled a judgement; a changed score appends a row and the history is readable; UPDATE and DELETE are refused by the database.

### Implementation

- [ ] T046 [US4] Implement `apps/api/src/modules/capabilities/repository.ts` and `service.ts` (edit with `lock_no`, evidence, delivery examples, offer and paid-type links, public-claim approval gate using the `claims` index to confirm the linked claim is approved and unexpired; audit and `capability.updated` in the same transaction) and `apps/api/src/modules/capabilities/projection.ts` (the only function that builds outward-facing capability views; it never reads the delivery example table); make T042 and T043 pass.
- [ ] T047 [US5] Implement `apps/api/src/modules/offers/paid-types.ts` (types, in-source deliverables seeded approved, `proposeDeliverable`, `decideDeliverable` with `paid_types.approve`; no price handling anywhere) and `apps/api/src/modules/offers/scores.ts` (criteria management with `offers.edit`, append-only scores validated against the configured scale, `status` always `hypothesis`); make T044 and T045 pass.

**Checkpoint**: capabilities, paid types and scores work with their own tests.

---

## Phase 7: Approvals, RBAC, audit and events (US1, US4, US5)

**Purpose**: The human approvals and access rules that complete claim governance, with audit and event checks across the feature.

- [ ] T048 [P] [US1] Write `apps/api/test/claims-review.int.test.ts` (V3 to V7): a restricted claim without evidence cannot be approved (`claim_needs_evidence`, suggestion to omit); one approver leaves it `in_review`; the drafter is refused (`drafter_cannot_approve`); the same approver twice does not count; a second different approver makes it `approved`; any reject stops it; a general claim needs one approval; every review has who, when and a note of at least 3 characters; UPDATE and DELETE on `claim_review` are refused by the database; evidence expiry in the past makes the claim read as `needs_review` and it can no longer cover text; AI and service actors cannot hold `claims.approve` (existing restriction rule).
- [ ] T049 [P] [US1] Write `apps/api/test/claims-dispositions.int.test.ts` (V6): a non-approver cannot mark a flag a false positive; an approver can, with a reason, for that exact sentence hash and rule only; a similar sentence is still flagged; the disposition is append-only.
- [ ] T050 [P] [US1] Write `apps/api/test/claims-phrase-list.int.test.ts`: a new phrase list version is a new immutable row owned by the marketing approver (`claims.phrases.manage`) and reviewed by a second designated approver who is not the author; the current list is the highest version; the checker reads the current version; an unreviewed or self-reviewed version is refused.
- [ ] T051 [US1] Implement `apps/api/src/modules/claims/review.ts` (draft, submit for review, approve and reject using `evaluateClaimApproval`, withdraw; false-positive dispositions; status moves `draft → in_review → approved|rejected`, `approved|in_review|draft → withdrawn`; editing the text of an approved claim refused), `apps/api/src/modules/claims/evidence.ts` (add, withdraw once) and the phrase-list version service in `apps/api/src/modules/claims/service.ts`; each action audited with its code and emits `claim.created` or `claim.reviewed`; make T048, T049 and T050 pass.
- [ ] T052 [P] [US1] Write `apps/api/test/claims-dependents.int.test.ts` (FR-008): when the evidence of the approved claim that covers a sentence in an in-force offer version's public fields is withdrawn or expires, the offer read model reports `claim_cover: "lapsed"` with the claim id and the sentence's rule id (never the text); the same for a capability whose `public_claim_id` claim needs review; nothing is stored by the read; restoring valid evidence clears it.
- [ ] T053 [US1] Implement the read-time claim-dependency check (re-evaluates the uncovered-phrase check for the in-force version through the `claims` index, and the linked claim status for capabilities) in `apps/api/src/modules/offers/service.ts` and `apps/api/src/modules/capabilities/service.ts`; make T052 pass.
- [ ] T054 [P] Write `apps/api/test/catalogue-rbac.int.test.ts` (V28), at service level: every one of the 15 new permissions is checked on every service mutation and read by an actor without it (refused and audited); only roles holding `claims.approve` or `paid_types.approve` can approve and neither can be held by AI or service actors; the read-only roles can read the catalogue but not examples; the documented role mapping matches research R-12.
- [ ] T055 [P] Extend `apps/api/test/audit-coverage.int.test.ts` (V29, SC-008): a version, status move, limitation acknowledgement, limit change, booking change, claim review, disposition, deliverable decision, capability edit and score each produce exactly one audit record naming who, written in the same transaction (a forced failure leaves neither the change nor the audit record).
- [ ] T056 [P] Write `apps/api/test/catalogue-events.int.test.ts` modelled on `apps/api/test/research-events.int.test.ts`: each of the six events is emitted exactly once per change with identifiers only; nothing is emitted for a refused action, for a booking change, a paid-type or deliverable decision, an evidence change or a claim withdrawal (those are audit-only, FR-029); a scan of the outbox shows no claim, offer, note, example or deliverable text.
- [ ] T057 Verify and complete the event emission (some services already emit) in `apps/api/src/modules/{claims,offers,capabilities}/events.ts` through the outbox; make T055 and T056 pass.
- [ ] T058 [P] Add the optional daily job `claims.staleness` (materialises `needs_review`, emits `claim.needs_review` once per claim) in `apps/api/src/modules/claims/service.ts` and its tick in `apps/api/src/main.ts`, following how `hypotheses.staleness` was added; write `apps/api/test/claims-staleness.int.test.ts` first (idempotent, no duplicate event, nothing stored by reads).

**Checkpoint**: all approvals are two-person where required, auditable and permission-gated.

---

## Phase 8: APIs (US1 to US5)

**Purpose**: REST routes for the three contracts, with idempotency and optimistic concurrency, registered in the composition root.

- [ ] T059 [P] [US1] Write `apps/api/test/contract/claims.contract.test.ts` against `specs/005-capabilities-offers-claims/contracts/claims.openapi.yaml` using `apps/api/test-support/openapi-contract.ts` (every path, method, status code, request and response schema).
- [ ] T060 [P] [US2] Write `apps/api/test/contract/offers.contract.test.ts` against `contracts/offers.openapi.yaml` (offers, versions, status, limitations, capacity and `GET /v1/offers/{id}/capacity/status`, bookings, scores, paid types and deliverables).
- [ ] T061 [P] [US4] Write `apps/api/test/contract/capabilities.contract.test.ts` against `contracts/capabilities.openapi.yaml`.
- [ ] T062 [US1] Implement `apps/api/src/modules/claims/routes.ts` (draft, list, get, evidence, review, lint, false-positive disposition, phrase list versions) with Zod request schemas, permission checks, `Idempotency-Key` on mutations and plain refusal messages with stable codes; make T059 pass.
- [ ] T063 [US2] Implement `apps/api/src/modules/offers/routes.ts` (`GET /v1/offers`, `GET /v1/offers/{id}`, `GET /v1/offers/{id}/versions`, version create, status move, limitations and acknowledgement, `PUT /v1/offers/{id}/capacity`, capacity status, bookings, scores, `GET /v1/paid-engagement-types`, deliverables) with `expectedVersion` returning 409 `stale_version`; make T060 pass.
- [ ] T064 [US4] Implement `apps/api/src/modules/capabilities/routes.ts` (`GET /v1/service-capabilities`, one capability, edit, evidence, delivery examples (permission gated), links, public-claim approval); make T061 pass.
- [ ] T065 Register the three services and their routes in `apps/api/src/app.ts` (composition root: `claims` first, then `offers` and `capabilities` receiving the claims index), and extend `apps/api/test/composition.int.test.ts` so a missing dependency fails startup.
- [ ] T066 [P] Write `apps/api/test/catalogue-routes.int.test.ts` covering V26 and V27 end to end over HTTP: a synthetic SSN-like string in a claim, an example and a deliverable is refused whole with nothing stored or logged; two edits with the same `lockNo` give 409 `stale_version` for the second; a repeated `Idempotency-Key` returns the first result and writes no second record; a missing key on a mutation is refused.
- [ ] T067 [P] Write `apps/api/test/catalogue-rbac-http.int.test.ts` (V28) over HTTP: every mutation and read route of the three contracts returns 403 with an audited refusal for a role without its permission, and 401 without a session; restricted approval routes refuse AI and service actors.

**Checkpoint**: every contract path passes its contract test.

---

## Phase 9: UI (US1 to US5)

**Purpose**: Offer Workspace v1, the Capability catalogue and the Claim review queue.

- [ ] T068 [P] Create the API clients `apps/web/src/lib/offers-api.ts`, `apps/web/src/lib/capabilities-api.ts` and `apps/web/src/lib/claims-api.ts` (typed, mapping stable refusal codes to plain messages, following `apps/web/src/lib/research-api.ts`).
- [ ] T069 [P] [US2] Write `apps/web/test/offers.test.tsx` (use `fireEvent`; this repo's typecheck has no `userEvent.setup` types for new tests): the list shows status, capacity utilisation, "baseline, attributes incomplete" and "to be provided" notices; the detail shows version history, limitations with an acknowledge control only for holders of `offers.limitations.acknowledge`, scores labelled hypothesis, effort estimate labelled hypothesis, a warning when an in-force version's claim cover has lapsed, the status and limitations of any offer reachable in at most three interactions from the list, status actions only with `offers.status.change`, and a plain message for each refusal (`limitation_unacknowledged`, `placeholder_attributes`, `uncovered_restricted_phrase`, `capacity_exhausted`, `stale_version`); free-text fields show the PHI warning.
- [ ] T070 [P] [US4] Write `apps/web/test/capabilities.test.tsx`: 19 entries with placeholders marked "to be provided", offer and paid-type links, delivery examples shown only with `capabilities.examples.read`, a warning when the linked public claim needs review, any capability's status and limitations reachable in at most three interactions, and the public-claim approval control gated by permission.
- [ ] T071 [P] [US1] Write `apps/web/test/claims.test.tsx`: claims by status, evidence with expiry, checker results with class and matched text, a `needs_review` badge, approve and reject controls only for holders of `claims.approve`, the drafter's own claim not approvable, false-positive control with a reason, and the suggestion to omit when evidence is missing.
- [ ] T072 [US2] Implement the Offer Workspace v1 in `apps/web/src/app/offers/page.tsx` and `apps/web/src/app/offers/offers-view.tsx` (list and detail, version history, limitations, scores, capacity and bookings, status actions); make T069 pass.
- [ ] T073 [US4] Implement the Capability catalogue in `apps/web/src/app/capabilities/page.tsx` and `apps/web/src/app/capabilities/capabilities-view.tsx`; make T070 pass.
- [ ] T074 [US1] Implement the Claim review queue in `apps/web/src/app/claims/page.tsx` and `apps/web/src/app/claims/claims-view.tsx`; make T071 pass.
- [ ] T075 Add navigation entries for Offers, Capabilities and Claims gated by `offers.read`, `capabilities.read` and `claims.read` in the navigation component covered by `apps/web/test/nav.test.tsx`, and extend that test (entry hidden without the permission).

**Checkpoint**: a service lead can find any capability or offer and see its status and limitations from the catalogue (SC-006).

---

## Phase 10: Scenario tests and polish

**Purpose**: Cross-feature scenarios, quickstart coverage, performance, documentation and gates.

- [ ] T076 [P] Write the cross-feature scenario test `apps/api/test/catalogue-scenarios.int.test.ts` for scenario E (content with "AI-ready", an SLA, SOC 2 and a case-study figure is flagged and cannot be approved) and scenario G (Offer 6 at capacity reads `exhausted`; a cancellation returns it to `room`), using the synthetic fixtures in `tests/fixtures/synthetic-orgs/`.
- [ ] T077 [P] Add `apps/api/test/catalogue-seed.int.test.ts` covering V8, V20 and V23 through the HTTP routes against the seeded database (10 offers, 3 paid types with no price field, 19 capability slots, no example in the list).
- [ ] T078 [P] Add `apps/api/test/catalogue-perf.int.test.ts`: the catalogue screen's data (10 offers and 19 capabilities) loads in under 2 seconds; the checker runs over 20,000 characters in under 50 ms (reuse the domain bound from T016 through the service).
- [ ] T079 Run the full quickstart (`specs/005-capabilities-offers-claims/quickstart.md`) V1 to V33 against the tests above and record in a "Progress notes" section at the top of this file which test covers which scenario and any deviation (follow the style of `specs/004-account-research-hypotheses/tasks.md`).
- [ ] T080 [P] Update `docs/context/05-open-questions.md` (#47 and #48 with the outcome of implementation), mark `docs/adr/ADR-019-claim-evidence-governance.md` as implemented, update the status table in the root `README.md` for feature 005, and add a note in `specs/004-account-research-hypotheses/tasks.md` Progress notes that research still uses its provisional capability list until names exist in this catalogue.
- [ ] T081 Run the repository gates from `netspective-hde-gtm-engine/`: `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm test`, `pnpm test:integration`, `pnpm test:contracts`; confirm at least 80% coverage on `packages/domain`; fix anything failing before reporting done.
- [ ] T082 Final checks: re-run the schema scan for price, fee, rate, cost, amount and currency columns across all feature 005 tables; confirm no seed text was invented beyond `docs/context/01-guardrails.md` (null elsewhere); grep logs, audit and outbox in the test run for claim, offer, example and deliverable text and PHI-like strings (none); confirm no model or network call exists in the new code.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** (schema, seed, events, harness) blocks every story.
- **Phase 3 (US1 checker)** needs only Phase 2; it is the MVP and everything else uses its `lintText` and claim lookup.
- **Phase 4 (US2)** needs Phase 3 (the gate calls the claims index). **Phase 5 (US3)** needs Phase 2 and Phase 4's repository (offer heads); it is otherwise independent of the gate.
- **Phase 6 (US4, US5)** needs Phases 2 and 3 (public-claim approval uses the claims index); US4 and US5 are independent of each other and of Phase 5.
- **Phase 7 (approvals, RBAC, audit, events)** needs Phases 3 to 6.
- **Phase 8 (APIs)** needs Phase 7; **Phase 9 (UI)** needs Phase 8; **Phase 10** needs everything.
- Within a phase: tests first (they must fail), then pure domain code, then the service, then integration.
- Feature dependencies: this branch builds on `main`, which already contains features 001–004 (migrations `0014`–`0016`); features 006, 007, 008 and 009 consume `capacityStatus`, `recordBooking`, the paid types and `lintText` later.

## Parallel Opportunities

- Phase 1: T002, T003, T004 together.
- Phase 2: T005 with T012; then T006 and T007 together, then T008 (it needs T006's `claim` table); T010 while T009 is in review.
- Phase 3: T015 to T019 (five domain tests) together; then T020, followed by T023 and T024 (they use its types); T025 beside T022.
- Phase 4: T027 to T030 together; T031 beside T032.
- Phase 5: T036 to T039 together.
- Phase 6: T042 to T045 together; T046 and T047 together.
- Phase 7: T048 to T050 and T052 together, then T054 to T056 together.
- Phase 8: T059 to T061 together; T067 once the routes exist.
- Phase 9: T068 to T071 together; T072 to T074 together.
- Phase 10: T076 to T078 and T080 together.

## Implementation Strategy

1. **MVP**: Phases 1 to 3 (setup, schema and seed, the claim checker with its corpus). This alone protects the company from unsupported public statements and can be demonstrated through the domain tests.
2. **Increment 2**: Phase 4 (offer versions, status, the gate, Offer 7's limitation). Phases 5 and 6 can then proceed in parallel.
3. **Increment 3**: Phase 7 (approvals and RBAC), then Phases 8 and 9 (APIs and screens), then Phase 10.
4. Stop and run the quickstart scenarios for a phase before starting the next. Commit after each task or logical group, and do not push or open a PR without being asked.
