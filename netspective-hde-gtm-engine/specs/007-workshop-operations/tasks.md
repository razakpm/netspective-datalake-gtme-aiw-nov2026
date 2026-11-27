---
description: "Task list for Feature 007 — Workshop Operations"
---

# Tasks: Workshop Operations

**Input**: Design documents from `/specs/007-workshop-operations/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Included and written first. Constitution Principle XVII forbids shipping automated behaviour without unit, contract and scenario tests. Every rule task is preceded by its test task, and the test must fail before the rule is implemented.

**Organization**: Setup → Foundational (schema, events, interfaces, booking methods, AI contracts) → the P1 stories (US1 lifecycle and booking, US2 capacity, US4 artifacts, US5 Offer 1 findings, US6 Offer 6 findings) → the P2 stories (US3 preparation brief, US7 buyer output) → US8 effort (P3) → screens → scenario tests and polish. Story labels follow the spec's numbering; phases follow priority. All paths are relative to `netspective-hde-gtm-engine/`.

## Format: `- [ ] T### [P?] [US#?] Description with file path`

- **[P]**: can run in parallel (different files, no unfinished dependency)
- **[US#]**: spec user story (US1 lifecycle and booking, US2 capacity, US3 preparation brief, US4 artifacts and PHI, US5 Offer 1 findings, US6 Offer 6 findings, US7 buyer output, US8 delivery effort)
- **Standard DoD** (applies to every task): lint, format and typecheck pass; the listed tests pass; no secret, PHI-like string or real data introduced (synthetic data only, `.example` hosts); every state change writes an audit event **in the same transaction**; no new column without a `COLUMN_CLASSIFICATION` entry; no name, note, finding, title, brief or output text, email or link in logs, audit or events (identifiers, codes and counts only); **no model call in any state, finalisation, approval, capacity, PHI or permission decision** (the only model calls are the brief in the US3 phase and the notes-assist in the US5 and US6 phases); nothing sends a message.
- Constraint text quoted from [data-model.md](data-model.md) is verbatim. Numeric defaults (session lengths 45 and 90 minutes, 1 MiB artifact limit, 3,500-character one-page budget, 12-month retention, the model cap) and the role mapping, kind list, boundary sentence and disclaimer wording are **hypotheses**, configurable, tracked in open question #53.
- Test files follow the layout of features 001–006 (domain tests under `packages/domain/test/`, provider tests under `packages/providers/test/`, integration under `apps/api/test/*.int.test.ts`, contracts under `apps/api/test/contract/`, DB tests under `packages/db/test/`, web tests under `apps/web/test/`).

## Path Conventions

Web application / modular monolith exactly as features 001–006: `apps/api`, `apps/web`, `packages/{domain,ai-contracts,providers,db}`. `apps/api/src/modules/workshops` (typed intake only today) is filled in; `offers`, `engagement`, `icp` and `providers` gain small additions.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Dependency, configuration, permissions, module entry points and test fixtures.

- [ ] T001 Add the runtime dependency `playwright-core` to `packages/providers/package.json` (used only by the PDF adapter) and commit the lockfile; confirm `docs/adr/ADR-021-workshop-findings-and-output.md` records it as a deployment dependency needing a Chromium binary.
- [ ] T002 Add configuration to `apps/api/src/config/index.ts` and `.env.example`, each labelled hypothesis: `CALENDAR_PROVIDER` (`none`, `fake` or `google`; default `none`), `CALENDAR_GOOGLE_ENABLED` (default `false`), `GOOGLE_CALENDAR_ID`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` (secrets), `WORKSHOP_AI` (`off` or `on`; default `off`), `WORKSHOP_AI_CAP` (default the interpretation cap `0.20`), `PDF_RENDERER` (`fake` or `playwright`; default `fake` outside production, production must set `playwright`), `WORKSHOP_MINUTES_OFFER_1` (default 45, 15 to 240), `WORKSHOP_MINUTES_OFFER_6` (default 90, 15 to 240), `WORKSHOP_ARTIFACT_MAX_BYTES` (default 1048576), `WORKSHOP_ARTIFACT_KINDS` (default `specification,timeline,scrubbed_rejection_log,interface_description,field_list,other_non_phi`), `WORKSHOP_UPLOAD_QUARANTINE` (default `true`), `WORKSHOP_RETENTION_MONTHS` (default 12, 1 to 120), `WORKSHOP_RETENTION_JOB_ENABLED` (default `false`), `OUTPUT_MAX_CHARS` (default 3500). Rules: `google` needs `CALENDAR_GOOGLE_ENABLED=true` and all four credentials; `CALENDAR_PROVIDER=fake` and `PDF_RENDERER=fake` are refused in production; the four Google values are in `secretValues` so logs scrub them. Extend `apps/api/test/config.test.ts` with default, override, invalid and production cases, and update the production cases in `apps/api/test/tls-config.test.ts`.
- [ ] T003 [P] Add the permissions `workshops.read`, `workshops.edit`, `workshops.output.approve` in `packages/domain/src/rbac/permissions.ts`; mapping (hypothesis, research R-15): `gtm_operator` read and edit; `research_analyst`, `technical_sme_reviewer` and `read_only_executive` read; `sales_service_lead` read, edit and approve; `administrator` everything; `workshops.output.approve` is restricted (humans only). Add descriptions in `packages/db/src/seed/reference.ts` and update every test that pins a permission list (`packages/domain/test/rbac/`, `packages/db/test/migrations.int.test.ts`, `apps/api/test/contract/users-auth.contract.test.ts`).
- [ ] T004 [P] Prepare entry points: export the new files from `packages/domain/src/workshops/index.ts` as they are added, create `packages/domain/src/events/feature007.ts` and export it from `packages/domain/src/index.ts`; confirm the boundary lint lets `apps/api/src/modules/workshops` import `offers`, `engagement`, `accounts`, `icp`, `signals`, `hypotheses`, `claims`, `audit` and `providers` only through their `index.ts`, and that `engagement` never imports `workshops`.
- [ ] T005 [P] Create synthetic fixtures under `tests/fixtures/workshops/`: `findings-cases.json` (an object of Offer 1 and Offer 6 cases, each `{ id, content, expectedShortfalls: [{ code, waivable }] }`, covering complete, two delay sources, four delay sources, a missing owner class, no boundary note, nine fields, eleven fields, a field with an unset observation, a `go` view with an unknown and no reason, no scope, a scope with three sources), `notes/northvale-offer1.txt` and `notes/riverbend-offer6.txt` (synthetic session notes that support some items and say nothing about others), `notes/injection.txt` (notes containing instructions to change state and mark the account qualified) and a `README.md` saying the cases are the acceptance test for the finalisation rules and only grow.
- [ ] T006 [P] Create `tests/fixtures/calendar/google/` with synthetic request and response shapes for the Google Calendar adapter: token exchange success and 401, event insert success with an id, free/busy answers (empty and with a busy interval), 429, 500, event delete success and 404; no real identifier, `.example` addresses only.

---

## Phase 2: Foundational (Schema, Events, Interfaces)

**Purpose**: Tables, classification, events, the file write side, transaction-level bookings, the AI contracts and the read exports every story needs. **No user story work starts before this phase is complete.**

- [ ] T007 Write the failing migration test `packages/db/test/feature007-migrations.test.ts`: migrations `0023` and `0024` apply forward-only; every table and column is in `COLUMN_CLASSIFICATION`; a schema scan fails on any column named like `price|fee|rate|cost|amount|currency|budget|password|secret|credential|email|phone|qualif|guarantee`; `workshop.state` in (`requested`,`booked`,`held`,`findings_recorded`,`closed`,`cancelled`,`no_show`) with "**Partial unique index** on (`request_id`) where `state` in (`requested`,`booked`,`held`,`findings_recorded`)"; `duration_minutes` "int 15 to 240"; "`scheduled_at`, `session_date`, `booking_id` and `booking_route` are all null in `requested`, all set from `booked` on"; final states never change; `offer_id`, `request_id`, `intake_id`, `account_id`, `contact_id`, `created_*` never change; `workshop_state_history`, `delivery_effort`, `workshop_brief`, `workshop_output_share` append-only; history `note` required for `cancelled`, `no_show`, `closed` and a reschedule; `delivery_effort` "`prep_hours` real, 0 to 80; `session_hours` real, 0 to 24; `people` int 1 to 20"; participant `display_name` "not null, max 120" and only `removed_*` change, once; `workshop_artifact` `title` "not null, max 200", `reference` "max 500", `classification` "check `= 'non_phi'`", "`reference` or `storage_key` is set when `state` is `received` or `released`" (a held upload with content only inserts), `held` moves only to `released` or `discarded`; `workshop_finding` "At most one `draft` per workshop", `waiver_reason` "min 10 when set", `correction_reason` required when `version_no` > 1, a `finalised` row never changes; `workshop_output_document` "`state = 'approved'` implies `pdf_storage_key` not null and `pdf_pages = 1`", approval columns set once, approved rows fixed except `file_deleted_at`, which can be set once; brief `review_status` (`unreviewed`,`reviewed`) and its two columns set once; only an approved output can be shared (trigger).
- [ ] T008 Create `packages/db/migrations-sqlite/0023_workshops.sql` with `workshop`, `workshop_state_history`, `workshop_participant`, `delivery_effort`, `workshop_artifact` and `workshop_brief` exactly as in data-model.md (columns, CHECKs, partial unique index, guard and append-only triggers).
- [ ] T009 Create `packages/db/migrations-sqlite/0024_workshop_findings.sql` with `workshop_finding`, `workshop_output_document` and `workshop_output_share` exactly as in data-model.md.
- [ ] T010 Register every new table and column in `packages/db/src/classification.ts` (participant names and roles and `supplied_by_label` as `business_contact`; notes, findings, brief, output text and artifact titles and references as `confidential_commercial`; identifiers, states, hashes and timestamps as `sensitive_operational_metadata`); update the migration list in `packages/db/test/migrations.int.test.ts`; make T007 pass.
- [ ] T011 [P] Write the failing event test `packages/domain/test/events/feature007.test.ts`: strict schemas for `workshop.requested` {`workshop_id`, `offer_id`, `request_id`}, `workshop.booked` {`workshop_id`, `offer_id`, `reschedule`}, `workshop.held` {`workshop_id`, `offer_id`} and `workshop.findings_recorded` {`workshop_id`, `offer_id`, `version_no`, `waived`}; any extra name, note, finding, title, text, link or date field is rejected.
- [ ] T012 Implement `packages/domain/src/events/feature007.ts` and register the four types; make T011 pass.
- [ ] T013 [P] Write the failing tests for the file write side in `packages/providers/test/file-storage.test.ts` and `local-file-storage.test.ts`: `put(key, bytes, contentType)` stores and reads back; `put` refuses to overwrite unless `overwrite: true`; the same safe-key rule as reads (no separators, no leading dot, no `..`, no following a symbolic link); a partial write never leaves a readable file; `delete(key)` removes and is idempotent.
- [ ] T014 Add `put` and `delete` to `packages/providers/src/interfaces/file-storage.ts`, `fakes/file-storage.ts` and `adapters/local-file-storage.ts` (write to a temporary file then rename; create the directory if absent); keep feature 006's delivery tests passing; make T013 pass.
- [ ] T015 [P] Write the failing test `apps/api/test/bookings-tx.int.test.ts`: `recordIn`, `rescheduleIn`, `cancelIn`, `holdIn` and `noShowIn` run inside the caller's transaction (a later throw rolls the booking back), write source `workshop`, need no `offers.bookings.edit`, apply the same capacity rule (409 `capacity_exhausted`) and audit each change; the public `reschedule`, `cancel`, `markHeld` and `markNoShow`, and the feature 005 PATCH route, refuse a booking whose source is `workshop` with 409 `booking_owned_by_workshop`, audited, and still work for manual bookings.
- [ ] T016 In `apps/api/src/modules/offers/bookings.ts` add the five transaction-level methods taking `(tx, context, …)`, make the existing public methods thin wrappers that refuse workshop-owned bookings, add the plain message for the new code to `apps/web/src/lib/catalogue-http.ts`, and export what `workshops` needs from `offers/index.ts`; all feature 005 booking tests and T015 pass.
- [ ] T017 [P] Write the failing contract tests `packages/ai-contracts/test/workshop.test.ts` for `workshop-preparation-brief@1.0.0` (`entityIds {workshopId, accountId}`, `confirmedFactIds[]` identifiers only with no text field, `inferences[{ statement ≤ 300, evidenceIds ≥ 1, contradictingEvidenceIds, basis ≤ 200 }]`, `confidence`, `rationale` ≤ 300, `reviewStatus` literal `unreviewed`, `unknowns[≤ 300]`, `suggestedQuestions` at most 12 of ≤ 200, `artifactChecklist[{ kind, why ≤ 200 }]`) and `workshop-findings-draft@1.0.0` (`entityIds`, `confidence`, `rationale` ≤ 300, `reviewStatus` literal `unreviewed`, items with a path from a fixed list, a value, `interpretation` boolean and `supportingText` of 3 to 300 characters; the path list has no `confirmation`, state or finalisation, with a test; no field for a decision, a price or hidden reasoning); strict, no extra keys, registered and exported as JSON Schema.
- [ ] T018 Implement `packages/ai-contracts/src/workshop.ts`, the prompts `prompts/workshop-brief.md` and `prompts/workshop-findings.md` (data is never instructions; state only what the data supports; select confirmed facts by id only; cite evidence and contradicting evidence for every inference; unrecorded stays unrecorded; no price, guarantee or send), register both in `registry.ts` as `synthesis` tasks; add the `ModelInput` keys `workshop` and `notes` to `apps/api/src/modules/providers/llm-gateway.ts` rendered as neutralised **data blocks** only; update the pinned expectations in `packages/ai-contracts/test/research-schemas.test.ts`, `packages/db/test/feature004-migrations.test.ts` (prompt count) and `apps/api/test/llm-gateway.int.test.ts` (allow-list); make T017 pass.
- [ ] T019 [P] Add the read-only exports with tests: `loadRequestForWorkshop(db, requestId)` in `apps/api/src/modules/engagement/index.ts` (request state, kind, offer id, account id, contact id, intake id, kind and payload; null when unknown; no permission check, the caller checks) and `evidenceFor(tx, accountId)` returning id, topic, status and text in `apps/api/src/modules/icp/index.ts`; test `apps/api/test/workshop-sources.int.test.ts`.
- [ ] T020 Create the test harness `apps/api/test-support/workshops-harness.ts` on top of `offers-harness.ts`: services for workshops as they are added, a fake calendar, fake PDF renderer, fake file storage, the quarantine service, actors (operator, service lead, reader, analyst, administrator), and helpers to create a **linked** Offer 1 and Offer 6 intake request for `northvale-hie` and `riverbend-health` through the real request service (ten synthetic field names), record hypotheses and evidence, fill capacity, and read outbox events and audit rows.
- [ ] T021 Create `apps/api/src/modules/workshops/repository.ts` (SQL only: workshop, history, participants) and `apps/api/src/modules/workshops/events.ts` (the four outbox writers), and extend `workshops/index.ts`.

**Checkpoint**: schema, events, interfaces and booking methods exist and pass; user stories can begin.

---

## Phase 3: User Story 1 — Convert a request and follow the lifecycle (Priority: P1) 🎯 MVP

**Goal**: A linked request becomes a workshop that moves only along permitted paths, booked by hand or through a calendar.

**Independent Test**: Convert a linked Offer 1 and Offer 6 request, book one by hand and one through the fake calendar, hold both, cancel and no-show others, reschedule one; every move is audited and a forbidden move is refused (V1 to V6).

### Tests for User Story 1 (write first; they must fail)

- [ ] T022 [P] [US1] Table-driven test `packages/domain/test/workshops/lifecycle.test.ts` over every (state, action) pair: `requested → booked | cancelled`; `booked → held | no_show | cancelled | booked (reschedule)`; `held → findings_recorded`; `findings_recorded → closed`; `cancelled`, `no_show`, `closed` final; a note required for cancel, no-show, close and reschedule; `scheduledAt` required for book and reschedule; refusal codes `invalid_transition`, `note_required`, `time_required`.
- [ ] T023 [P] [US1] Shared provider contract test `packages/providers/test/contract/calendar.contract.test.ts` run against the fake and against the Google adapter with an injected `fetch` replaying T006: create returns a reference and start; cancel; a busy interval from `freeBusy.query` gives code `conflict` and no insert is made; 401, 429, 500 and timeout give failed results; **no request ever contains `attendees` or an email address and every Google event call has `sendUpdates=none`**; only `oauth2.googleapis.com` and `www.googleapis.com` are called; no token or credential appears in a result or log.
- [ ] T024 [P] [US1] Integration test `apps/api/test/workshops-lifecycle.int.test.ts`: conversion of a linked request (V1), refusals `request_not_linked`, `offer_not_supported`, `workshop_open` including two attempts in a row (V2); book by hand and by calendar with duration 45 or 90 and a booking row with source `workshop` (V3); calendar failure leaves `requested` and manual booking still works (V4); hold, no-show, cancel, reschedule with date history, close needs finalised findings (V5, V6); `lockNo` conflict `stale_version`; a calendar failure on cancel or reschedule still changes the booking and records a note that the event needs attention; offer withdrawn blocks booking (`offer_unavailable`) but allows hold or cancel; every move audited with who, when and why and refusals audited without content; participants added and removed, with no email or phone accepted; when the account or contact is suppressed or consent is withdrawn after booking, the workshop stands, the read carries a notice and nothing contacts the person (spec Edge Cases).

### Implementation for User Story 1

- [ ] T025 [US1] Implement `packages/domain/src/workshops/lifecycle.ts` (pure `checkWorkshopTransition`, `WORKSHOP_STATES`, durations taken from configuration); make T022 pass.
- [ ] T026 [P] [US1] Implement `packages/providers/src/interfaces/calendar.ts` (`createEvent({ title, start, durationMinutes, attendeeLabels })`, `cancelEvent(ref)`, `ProviderResult`) and `fakes/calendar.ts` (scriptable failure and conflict); export from the package index.
- [ ] T027 [US1] Implement `packages/providers/src/adapters/google-calendar.ts` over `fetch` (refresh-token exchange, `freeBusy.query` before insert, insert and delete on the configured calendar, labels in the description, no attendee list, `sendUpdates=none`, timeout, through the existing guarded call so the payload is PHI-checked and bodies are never logged); make T023 pass.
- [ ] T028 [US1] Implement `apps/api/src/modules/workshops/lifecycle-service.ts`: `convert(actor, requestId)` (needs `workshops.edit`; uses `loadRequestForWorkshop`; only a `linked` request of kind intake for Offer 1 or 6), `list`, `get`, `transition(actor, id, { action, lockNo, scheduledAt?, via?, note? })` (calendar first when `via: calendar`, then **one transaction** with the booking method, state, history, audit and event; `session_date` in the business time zone; offer must be approved or available to book); the read adds a `notices` list from the feature 002 suppression check and the latest consent record (the contract field exists); PHI guard on notes; make T024 pass.
- [ ] T029 [US1] Implement `apps/api/src/modules/workshops/participants.ts` (add, remove; side `buyer` or `delivery`; name "max 120"; optional contact id that must belong to the account; PHI guard; audited) with its cases in T024.
- [ ] T030 [US1] Compose `apps/api/src/workshops-stack.ts` (services; calendar selection from configuration, `none` giving no calendar booking; ports) and register it in `apps/api/src/app.ts` and `apps/api/test-support/identity-fixture.ts`.
- [ ] T031 [US1] Add routes in `apps/api/src/modules/workshops/routes.ts` for list, convert, get, transition and participants per `contracts/workshops.openapi.yaml` (idempotency keys, Problem `codes`); DRIVERS entries in `apps/api/test/audit-coverage.int.test.ts`; contract cases in `apps/api/test/contract/workshops.contract.test.ts`.

**Checkpoint**: a request can be converted, booked, held, cancelled and rescheduled through the API. MVP.

---

## Phase 4: User Story 2 — Booking uses capacity and cancelling releases it (Priority: P1)

**Goal**: One booked workshop takes one place; cancelling gives it back; a full offer refuses with the alternatives.

**Independent Test**: Fill Offer 6, try to book (refused), cancel one, book again (succeeds) (V7 to V9).

- [ ] T032 [P] [US2] Failing integration test `apps/api/test/workshops-capacity.int.test.ts`: exactly one session per booking in the period of the session date; a full offer refuses with `capacity_exhausted`, the capacity answer, and the workshop stays `requested`; the feature 006 wait-list accepts the account afterwards; cancel releases at once; held and no-show still count; reschedule into a full period is refused with the original booking unchanged, into a free one moves the place; two workshops cannot both take the last place; an offer with no limit books and reads "no limit set"; feature 005's booking routes cannot change a workshop's booking; Scenario G still passes.
- [ ] T033 [US2] In `lifecycle-service.ts` return the offer's capacity answer (for the booked date, else today) as `capacity` on the workshop read, and include `capacity_exhausted` refusals with a plain message naming the wait-list; make T032 pass and add the 409 case to the contract test.

**Checkpoint**: capacity can never be exceeded by a workshop.

---

## Phase 5: User Story 4 — Record non-PHI artifacts safely (Priority: P1)

**Goal**: Artifacts are recorded as references or checked text; anything that looks like PHI is held and the operator alerted.

**Independent Test**: Record clean artifacts, then the `granite-health` PHI cases; each is held, reaches no table, model or log, and alerts the operator (V13, V14).

- [ ] T034 [P] [US4] Failing domain test `packages/domain/test/workshops/artifacts.test.ts`: kinds come from the configured list and an unknown kind is refused (`artifact_kind_not_allowed`); a file name must match `^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\.(txt|md|csv|json|log)$` (else `binary_not_accepted`); a reference or content is required; the size limit in bytes; control characters or a null byte in content mark it binary; `checklist(kinds, artifacts)` gives `received`, `held` or `not_received` per kind.
- [ ] T035 [P] [US4] Failing integration test `apps/api/test/workshops-artifacts.int.test.ts` (Scenario D): a reference and a clean scrubbed log are received with a hash and stored through the file provider; every prohibited sample in `tests/fixtures/phi-samples/prohibited.json` sent as content is answered 202, stored only in the encrypted quarantine item (never in any workshop table or the file store), the row is `held` with rule ids only, an `operator.alert.phi` event and an audit event without content are written, and the fake model and logs never receive it; a PHI-like title, reference or supplier label refuses the whole entry (422); when the guard throws the entry is refused; `release` and `discard` need `quarantine.review` and a reason through the workshop route **or** the existing quarantine routes, and the artifact is synced from the quarantine item on the next list or read; a release takes the content once with `consumeRelease` and is accepted only when the guard version matches the hold and every matching rule is one that held it (another rule keeps it held, unconsumed, with the new rule ids); purged content cannot be released; a discarded one stays discarded; the first hold raises the alert, a second within a minute is suppressed, and both holds are listed; content reads need `workshops.read`, are refused for held or discarded items and give 410 after deletion.
- [ ] T036 [US4] Implement `packages/domain/src/workshops/artifacts.ts`; make T034 pass.
- [ ] T037 [US4] Implement `apps/api/src/modules/workshops/artifacts.ts`: guard title, reference and supplier as `api_body` (whole refusal), guard content at the `upload` entry point with the quarantine policy from `WORKSHOP_UPLOAD_QUARANTINE`, hold through `QuarantineService.hold`, raise the operator alert, store clean content with `put`, record the row and audit in one transaction (delete the stored file if the transaction fails), `decide` and `syncFromQuarantine` (the release recheck of R-10, then `put`; discard), `read`, `list` with the checklist; make T035 pass.
- [ ] T038 [US4] Add the artifact routes to `workshops/routes.ts` (record with `config.skipPhiGuard`, a body limit of the artifact maximum plus overhead, 201 or 202; list; decision; content as `text/plain` with `cache-control: no-store`); DRIVERS entries; contract cases.

**Checkpoint**: the data boundary holds for everything a workshop receives.

---

## Phase 6: User Story 5 — Offer 1 findings (Priority: P1)

**Goal**: Three classified delay sources, confirmed or not, finalised by rule and versioned; a model may only suggest.

**Independent Test**: Finalise a complete set; two sources need a waiver, four are refused; a correction is a new version (V15 to V17, V20 to V23).

- [ ] T039 [P] [US5] Failing table-driven test `packages/domain/test/workshops/findings-offer1.test.ts` over `findings-cases.json`: `flowSummary` "at most 1,000", `delaySources` "**at most 3**", each `description` "at most 300", `ownerClass` "one of `operator`, `sender`, `rule_owner`", delay "`{ kind: "quantified", amount > 0, unit: hours | days | weeks }` or `{ kind: "not_quantified" }`", `confirmation` "one of `confirmed`, `not_confirmed`, `unknown`" with `confirmedBy` and `confirmedAt` when not unknown, `unknowns` "up to 10 of at most 300", `suggestedNextStep` "at most 500", `boundaryNote` "at most 600, must begin with the standard boundary sentence"; `finalisable` returns shortfalls with `waivable` true only for fewer than three sources; a schema key scan refuses price, budget, fee, guarantee, economic buyer, funding and qualification keys.
- [ ] T040 [P] [US5] Failing integration test `apps/api/test/workshops-findings-offer1.int.test.ts`: a draft can be saved only for a held workshop; `lockNo` conflicts; finalise moves to `findings_recorded` once and emits `workshop.findings_recorded` with `waived`; fewer than three needs `waiverReason` "min 10"; a fourth source is refused (`too_many_delay_sources`); finalised content never changes; a correction needs a reason, creates version 2 as a draft, keeps version 1; a confirmation records who and when and an unconfirmed item is never returned as confirmed; confirming after finalisation needs a new version with a correction reason, finalised again; PHI-like text, a price or a pasted sample row refuses the whole save; audit without content.
- [ ] T041 [US5] Implement the Offer 1 schema, the boundary sentence constant and `finalisable` in `packages/domain/src/workshops/findings.ts`; make T039 pass.
- [ ] T042 [US5] Implement `apps/api/src/modules/workshops/findings.ts` (get with shortfalls, saveDraft, finalise, correct; kind from the workshop's offer; PHI guard and a price and guarantee check on every text; confirmation stamping by the server, never taken from the client or a suggestion) and its routes; DRIVERS and contract cases; make T040 pass.
- [ ] T043 [P] [US5] Failing tests for the notes-assist on Offer 1 in `apps/api/test/workshops-suggest.int.test.ts` with the fake model: items whose `supportingText` is a substring of the notes (after the research normalisation) are returned, others dropped and counted; an item whose value holds a number, system name or field name its quote lacks is dropped; owner class and status items carry `interpretation: true`; no item targets a confirmation or state; the result carries entity ids, confidence, rationale, `unreviewed`, model and versions; no fourth delay source, no owner or number the notes lack; nothing is written to any workshop table; injection notes change no state and nothing but data blocks reach the model; patient-like notes refuse the request (422) with no model call; model off, error or over cap gives 503 `ai_unavailable` and the draft is unaffected; one `ai_invocation` row with no text.
- [ ] T044 [US5] Implement `apps/api/src/modules/workshops/suggest.ts` (needs `workshops.edit`; builds the `notes` input; per-call cap `WORKSHOP_AI_CAP` and the account's monthly allowance supplied by the composition root; verifies support; returns the contract `Suggestion` shape, stores nothing), the pure support check in `packages/domain/src/workshops/findings.ts`, and the suggest route; make T043 pass.

**Checkpoint**: Scenario A findings can be recorded and finalised.

---

## Phase 7: User Story 6 — Offer 6 findings (Priority: P1)

**Goal**: Ten intake fields traced with known good, gap or unknown, a bounded overall view and a draft Input Audit scope.

**Independent Test**: Finalise ten fields with mixed statuses; nine need a waiver; an unknown is never a gap; a bad scope is refused (V18, V19).

- [ ] T045 [P] [US6] Failing table-driven test `packages/domain/test/workshops/findings-offer6.test.ts`: `fields` "exactly the ten intake names in order", `sourceSystem` and `sourceInterface` "at most 120", `observations` `quality`, `completeness`, `freshness`, `provenance`, `access`, each "`{ status: known_good | gap | unknown, note at most 300 }`"; `overall.view` go, no_go or conditional, `dependsOnUnknowns` "up to 20", `reason` "at most 500"; the disclaimer equals the constant; `inputAuditScope` `useCase` "at most 200", `sources` "one or two of at most 120"; observation `status` may be `null` (not recorded); shortfalls: fewer than ten fields recorded, a field being recorded only when all five have a status (waivable), a changed name without a reason, `go` with any unknown or unrecorded observation and no reason, missing scope (not waivable); a renamed field is marked changed; `summarise` counts known good, gap, unknown and not recorded separately and **never** merges unknown into gap.
- [ ] T046 [P] [US6] Failing integration test `apps/api/test/workshops-findings-offer6.int.test.ts`: the draft starts from the intake's ten names with every status `null` (not recorded); finalising with nine recorded needs the waiver and shows the tenth as not recorded; an eleventh or foreign name is refused (`field_list_fixed`); finalise rules and waiver; every unknown appears in the view's dependency list and the summary as unknown; a scope with three sources or two use cases refused; values, sample records, a date of birth, a price or a guarantee refuse the whole save; versions and audit as in T040.
- [ ] T047 [US6] Implement the Offer 6 schema, disclaimer constant, `summarise` and rules in `packages/domain/src/workshops/findings.ts` and the Offer 6 paths in `apps/api/src/modules/workshops/findings.ts`; make T045 and T046 pass.
- [ ] T048 [US6] Extend the notes-assist for Offer 6 in `suggest.ts` (source system, interface and statuses only for names in the intake list; anything unsupported stays not recorded) with cases added to `workshops-suggest.int.test.ts`.

**Checkpoint**: Scenario B findings and the Input Audit scope can be recorded.

---

## Phase 8: User Story 3 — Preparation brief (Priority: P2)

**Goal**: A brief that only states what the evidence supports, with a no-model fallback.

**Independent Test**: Brief `northvale-hie` and `riverbend-health`; model wording never appears as a confirmed fact; injection changes nothing (V10 to V12).

- [ ] T049 [P] [US3] Failing table-driven test `packages/domain/test/workshops/brief.test.ts`: `baselineBrief` puts the **own text** of `observed` and `buyer_confirmed` records in confirmed facts with their ids, derived or AI-sourced ones in inferences citing them, every `contradictory` record in contradictions, gaps in unknowns, the fixed question list per offer and a checklist of configured non-PHI kinds; `verifyBrief` builds confirmed facts only from the evidence text of valid confirming ids (model wording can never appear there), drops an inference with no valid evidence id, rejects wrong entity ids, keeps contradictions whatever the model returned and drops a checklist kind outside the list; at most 12 questions; deterministic.
- [ ] T050 [P] [US3] Failing integration test `apps/api/test/workshops-brief.int.test.ts`: model off gives the baseline with a notice; model on gives `source: model` with model, prompt and schema version, confidence, rationale and `unreviewed`; no model sentence appears as a confirmed fact; a person marks it reviewed once; the call is checked against `WORKSHOP_AI_CAP` and the account's monthly allowance and its cost recorded; injection text in intake or evidence has no effect and reaches the model only as data; evidence that fails the PHI check is left out; model error, invalid output, PHI in the answer or an exceeded cap give the baseline with a notice and change nothing else; a new brief keeps the earlier one marked superseded; one `ai_invocation` row per call; refused for a cancelled workshop with `invalid_transition`.
- [ ] T051 [US3] Implement `packages/domain/src/workshops/brief.ts` (content schema, `baselineBrief`, `verifyBrief`, question lists labelled hypotheses); make T049 pass.
- [ ] T052 [US3] Implement `apps/api/src/modules/workshops/brief.ts` (assemble intake, `evidenceFor`, approved current signals and accepted hypotheses; guard each text; gateway call with the `workshop` input under `WORKSHOP_AI_CAP` and the monthly allowance; verify; store append-only; `markReviewed`; audit) and its routes (including mark reviewed); DRIVERS and contract cases; make T050 pass.

**Checkpoint**: the delivering engineer has a brief with or without a model.

---

## Phase 9: User Story 7 — The one-page buyer output (Priority: P2)

**Goal**: A gated, reviewed, one-page PDF from finalised findings; sharing recorded, nothing sent.

**Independent Test**: Generate, edit, approve and share; each gate refuses with its reason; a correction makes it out of date (V24 to V27).

- [ ] T053 [P] [US7] Failing table-driven test `packages/domain/test/workshops/output.test.ts`: the draft is built only from findings, for both offers; sections `summary` "≤ 1,200", `findings` "≤ 1,200", `unknowns` "≤ 600", `nextStep` "≤ 500", `inScope` and `outOfScope` "1 to 8 items of ≤ 150"; the generated sections (`findings`, `unknowns`, `boundaryNote`, `disclaimer`) cannot be edited and must equal the builder's output; gates `scope_section_missing`, `disclaimer_missing` (Offer 6, unmodified constant), `over_one_page` (total over `OUTPUT_MAX_CHARS`), `price_stated`, `generated_section_changed`; an unrecorded observation reads "not recorded"; an unknown is rendered as unknown and no template text near it says gap or fail; a not-confirmed delay reads "not confirmed"; a waived shortfall is stated; `renderHtml` escapes every text and contains no script, link or remote resource.
- [ ] T054 [P] [US7] Failing tests `packages/providers/test/pdf-renderer.test.ts` for `render(html) → { bytes, pages }`: the fake counts pages from the text length and returns deterministic bytes; the Playwright adapter test runs only when `PDF_RENDERER_REAL=1` (real Chromium: one page for a normal output, two for an over-long one, scripts and network disabled).
- [ ] T055 [P] [US7] Failing integration test `apps/api/test/workshops-output.int.test.ts`: needs finalised findings (`output_not_ready`); each edit names the revision it was based on and a second save from the same base is refused `stale_version`; an attempt to send a generated section is refused; each edit a new revision and findings unchanged; removing a scope section refused; restricted wording not covered by an approved claim (`restricted_wording`) and a price refused at approval; an operator cannot approve (403, audited), the service lead can; approval stores the PDF with hash and one page, fixes the row; a render failure or two pages leaves the draft; PDF download refused for a draft; share needs approved and current, records who, when, how, and sends nothing; a findings correction makes it `output_out_of_date`.
- [ ] T056 [US7] Implement `packages/domain/src/workshops/output.ts` (sections schema, builder, gates, HTML template); make T053 pass.
- [ ] T057 [US7] Implement `packages/providers/src/interfaces/pdf-renderer.ts`, `fakes/pdf-renderer.ts` and `adapters/playwright-pdf.ts` (`playwright-core` Chromium, A4, JavaScript off, all requests aborted); export from the package index; make T054 pass with the fake and run it once with `PDF_RENDERER_REAL=1`.
- [ ] T058 [US7] Implement `apps/api/src/modules/workshops/output.ts` (generate, edit with the required `baseRevisionNo`, approve with `workshops.output.approve` and the claims `checkText` with the current phrase list, store through `put`, download, share) and its routes, renderer selection in `workshops-stack.ts`; DRIVERS and contract cases; make T055 pass.

**Checkpoint**: an approved one-page PDF exists for each offer and nothing was sent.

---

## Phase 10: User Story 8 — Delivery effort (Priority: P3)

**Goal**: Effort recorded per workshop and summarised per offer beside the estimate.

**Independent Test**: Record effort on three workshops; the summary shows totals, averages and the missing count; a bad figure is refused (V28).

- [ ] T059 [P] [US8] Failing tests `packages/domain/test/workshops/effort.test.ts` and `apps/api/test/workshops-effort.int.test.ts`: `prepHours` 0 to 80 in steps of 0.25, `sessionHours` 0 to 24, `people` 1 to 20; out of range refused; a correction is a new entry and the latest counts; the summary per offer gives workshops, with effort, missing (not zero), totals, averages (null when none) and the offer's effort estimate text labelled `hypothesis`; cancelled workshops excluded from "missing".
- [ ] T060 [US8] Implement `packages/domain/src/workshops/effort.ts`, `apps/api/src/modules/workshops/effort.ts` and its routes (effort and `/workshop-effort-summary`); DRIVERS and contract cases; make T059 pass.

---

## Phase 11: Screens

**Purpose**: The workshop list and workspace. API clients are injected as in features 004 to 006; screens show plain messages for codes, never server text; controls only with the permission.

- [ ] T061 [US1] Create `apps/web/src/lib/workshops-api.ts` and add the codes of `contracts/workshops.openapi.yaml` to the plain-message map in `apps/web/src/lib/catalogue-http.ts`.
- [ ] T062 [P] [US1] Test `apps/web/test/workshops.test.tsx` then implement `apps/web/src/app/workshops/{page.tsx,workshops-view.tsx}`, the "Convert to workshop" action on a linked intake request in `apps/web/src/app/requests/requests-view.tsx` (extend its test), and the nav item "Workshops" (`workshops.read`) in `apps/web/src/components/nav.tsx` with its test.
- [ ] T063 [US1] Test `apps/web/test/workshop-workspace.test.tsx` then implement `apps/web/src/app/workshops/[id]/{page.tsx,workshop-workspace.tsx}`: intake, participants, history, booking and state controls (manual or calendar), capacity answer with the wait-list alternative (US2), delivery effort (US8).
- [ ] T064 [P] [US4] Add the brief panel (US3, with confirmed facts, inferences, contradictions, confidence, rationale and "mark reviewed") and the artifact checklist with record form, held notice and the text-only explanation to the workspace in `apps/web/src/app/workshops/[id]/brief-panel.tsx` and `artifacts-panel.tsx`, with `apps/web/test/workshop-panels.test.tsx`; use `PhiWarning` on every free-text input.
- [ ] T065 [P] [US5] Test `apps/web/test/findings-offer1.test.tsx` then implement `apps/web/src/app/workshops/[id]/findings-offer1.tsx`: three delay source editors with owner class, quantified or not, confirmation; shortfalls list; waiver reason; finalise; correct; "suggest from my notes" fills the form without saving, shows each quoted support, and applies an interpretive value only when ticked; the pasted notes are not stored.
- [ ] T066 [P] [US6] Test `apps/web/test/findings-offer6.test.tsx` then implement `findings-offer6.tsx`: ten fixed field rows with the five observations starting as not recorded with unknown chosen explicitly, a summary that shows unknown separately and never in a gap style, overall view and reason, the disclaimer, scope with at most two sources, shortfalls, waiver, finalise, suggest (a suggested status is applied only when ticked).
- [ ] T067 [P] [US7] Test `apps/web/test/output-panel.test.tsx` then implement `output-panel.tsx`: preview, editors for the title, summary, next step and scope lists only (generated sections read-only, scope lists cannot be emptied), problems list, approve only with `workshops.output.approve`, PDF download, record sharing, out-of-date marker.

---

## Phase 12: Scenario tests and browser test

- [ ] T068 Always-on `apps/api/test/workshop-scenarios.int.test.ts` over the synthetic fixtures through the real routes (V32): Scenario A (linked Offer 1 intake for `northvale-hie` → workshop → booked → held → three classified delay sources → delay and owner confirmation → output approved; economic buyer and funding left unknown, no qualification record anywhere), Scenario B (`riverbend-health` → booked → ten fields traced → conditional view with unknowns → draft Input Audit scope), Scenario D (`granite-health` artifact held, nothing reaches a model or log); events carry identifiers only; timing checks for the plan's goals (read, save and transition under 300 ms, baseline brief under 1 s, approval under 5 s with the fake renderer).
- [ ] T069 Add `apps/web/e2e/workshop.spec.ts` and extend `apps/web/e2e/support/api-stack.ts` (lead and operator tokens, fake calendar and PDF): the visitor submits the intake form in the browser; the operator steps (link, convert, book, hold, findings, output) run through the API, because signing in through an identity provider is outside the test; say so in the test header. Run `pnpm test:e2e`.

---

## Phase 13: Polish & Cross-Cutting Concerns

- [ ] T070 [P] Retention (V31): failing test `apps/api/test/workshops-retention.int.test.ts` then `apps/api/src/modules/workshops/retention.ts` and its registration in the worker with a daily tick behind `WORKSHOP_RETENTION_JOB_ENABLED`: files of workshops that reached an end state (closed, cancelled, no-show), or never did and were last changed, more than `WORKSHOP_RETENTION_MONTHS` ago are deleted, including approved output PDFs, `file_deleted_at` set, each audited without content; metadata, findings and audit stay; idempotent; a failed delete is retried next tick.
- [ ] T071 [P] `apps/api/test/workshops-rbac-audit.int.test.ts` (V29, V30): every route as each role lacking the permission gives 403 and one audited refusal; an AI or system actor can never move a state, finalise or approve; one audit record per change; no name, note, finding, title, brief or output text in any audit row, event, guard record or invocation row.
- [ ] T072 [P] Documentation: update `docs/context/05-open-questions.md` rows #52 to #54 with what was built, add the Chromium install note and the Google Calendar switch to the quickstart if behaviour differs, and update `contracts/workshops.openapi.yaml` wherever the implemented shapes differ (every contract operation must be exercised by the contract test).
- [ ] T073 Run `pnpm lint`, `pnpm typecheck`, `pnpm format`, `pnpm test`, `pnpm test:integration` and `pnpm test:contracts`; confirm `packages/domain` and `packages/ai-contracts` coverage stays at or above 80%; walk quickstart V1 to V32 and record the V-to-test mapping and every deviation in the Progress notes at the top of this file.

---

## Dependencies & Execution Order

- **Phase 1** (T001–T006) has no dependencies; T003 to T006 can run in parallel with T001 and T002.
- **Phase 2** (T007–T021) depends on Phase 1. T007→T008→T009→T010; T011→T012; T013→T014; T015→T016; T017→T018; T019; T021 after T012; T020 last. **Blocks all stories.**
- **US1 (Phase 3)** depends on Phase 2 and is the MVP. T025 after T022; T026→T027 after T023; T028 after T024 to T027; T030→T031 last.
- **US2** depends on US1. **US4** depends on US1 (a workshop to attach to). **US5** depends on US1; **US6** depends on US5 (shared findings service and suggest module). **US3** depends on US1 and uses T018. **US7** depends on US5 and US6 and on T014. **US8** depends on US1.
- US2, US4, US5 and US8 can proceed in parallel after US1; US3 can run beside them.
- **Phase 11** needs the routes of the story each screen serves. **Phase 12** needs US1 to US7. **Phase 13** needs everything it checks.
- Within each story: tests first and failing, then pure domain code, then services, then routes and contract cases.

## Parallel Opportunities

- Phase 1: T003, T004, T005, T006.
- Phase 2: the test tasks T011, T013, T015, T017 and T019 are independent files.
- US1: T022, T023 and T024 together; T026 alongside T025.
- After US1: US2 (T032), US4 (T034, T035), US5 (T039, T040), US3 (T049, T050) and US8 (T059) tests can be written together.
- Screens: T062, T064, T065, T066 and T067 are different files.

## Implementation Strategy

- **MVP**: Phases 1 and 2 and US1: a linked request becomes a workshop that can be booked, held and cancelled with capacity counted atomically. Stop and validate V1 to V6.
- **Then the safety rules** (US2 capacity, US4 data boundary), **then the product** (US5, US6 findings), **then assistance and the page the buyer gets** (US3, US7), then effort, screens and scenarios.
- **Model off by default**: every story works with the fake providers and no model; the brief has its baseline and the notes-assist simply reports it is unavailable.
- **External switches stay off**: the Google Calendar adapter and the real PDF renderer are never used by tests that run by default.
- **Scope guard**: nothing sends a message, invites anyone, records a qualification decision, an economic buyer or a funding path (feature 008), or sends the output (feature 009).

## Notes

- Total tasks: 73 (T001–T073). Per phase: Setup 6, Foundational 15, US1 10, US2 2, US4 5, US5 6, US6 4, US3 4, US7 6, US8 2, Screens 7, Scenarios 2, Polish 4.
- Every task names its file path. Quoted constraints are copied from data-model.md.
