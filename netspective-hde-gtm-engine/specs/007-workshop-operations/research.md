# Research: Workshop Operations

Decisions taken in planning. Numeric and structural defaults are **hypotheses** unless stated, and are tracked in open question #53. Every decision lists what was weighed.

## R-01 Module boundaries and how `workshops` reaches the others

**Decision**: all new behaviour lands in the existing `workshops` module (feature 006 left it holding typed intake only). It reads other modules **only through their public `index.ts`**:

| Needs | From | Through |
|---|---|---|
| a linked request and its intake | `engagement` | a new read-only export `loadRequestForWorkshop(db, requestId)` (no permission check; the workshop route checks `workshops.edit`) |
| booking, rescheduling, cancelling, holding, no-show, with capacity | `offers` | new transaction-level methods on `BookingService` (R-03) |
| the offer's name, in-force status and effort estimate | `offers` | the existing offer read model |
| account name, type | `accounts` | `getAccount`, `currentClassification` (already public) |
| recorded evidence, approved signals, accepted hypotheses | `icp`, `signals`, `hypotheses` | `evidenceFor` (new export from `icp`), `currentEvidence` (signals), `HypothesisService.list` |
| restricted-wording check | `claims` | `checkText`, `currentPhraseList` (already public) |
| holding suspected PHI | `audit` | `QuarantineService.hold` |
| the language model | `providers` | `LlmGateway` |

`engagement` never imports `workshops`: the typed-intake validator is still wired at the composition root (`engagement-stack.ts`), so there is no cycle.

**Rationale**: constitution XVI (public indexes only) and no new coupling between the two modules that already meet at the composition root.

**Alternatives**: read the other modules' tables directly (rejected: breaks the boundary rule); move conversion into `engagement` (rejected: it would pull workshop lifecycle into the public-input module).

## R-02 The workshop lifecycle as a pure state machine

**Decision**: a pure `checkWorkshopTransition(from, action)` in `packages/domain/src/workshops/lifecycle.ts`, table-tested, with the moves of spec FR-002:

`requested → booked | cancelled`; `booked → held | no_show | cancelled | booked (reschedule)`; `held → findings_recorded`; `findings_recorded → closed`. `cancelled`, `no_show` and `closed` are final. A transition needs a person; a note is required for `cancelled`, `no_show` and `closed` and for a reschedule (the reason), and optional otherwise.

The stored state is the head's `state` column; every move appends a row to `workshop_state_history` (who, when, note, the date before and after for a reschedule). A **partial unique index** on `workshop(request_id)` where the state is open (`requested`, `booked`, `held`, `findings_recorded`) enforces "one open workshop per request" without a race; a no-show or cancelled request can start a new one.

**Rationale**: constitution IX (deterministic rules as plain code with tests) and FR-001 to FR-003.

**Alternatives**: a status per feature (rejected: duplicates); letting a model suggest a state (forbidden).

## R-03 Booking and capacity: reuse feature 005's bookings, atomically

**Decision**: a workshop's booking **is** a feature 005 `offer_session_booking` row (source `workshop`, which the table already allows). `BookingService` today opens its own transaction and requires `offers.bookings.edit`, so a workshop could neither share a transaction with its state change nor be used by an operator. Add `recordIn(tx, …)`, `rescheduleIn`, `cancelIn`, `holdIn` and `noShowIn` taking a `Tx` and an acting context, with no permission check (the caller, `WorkshopService`, checks `workshops.edit`), and keep the existing public methods as thin wrappers so feature 005's behaviour and tests do not change. Capacity is checked by the same `assertRoom`.

While reading it I found that `assertRoom` raises `new CatalogueRefusal("…")` with only a message, so the status and the `capacity_exhausted` code are lost (the first argument is the status). It is fixed here to `CatalogueRefusal(409, "Offer is full", ["capacity_exhausted"], [], message)`, with a test, because the workshop refusal and the wait-list alternative depend on the code.

A workshop that is held or a no-show keeps its booking counted; a cancelled one is released (spec FR-009), exactly as feature 005 defines. A reschedule that moves the date to a full period is refused and nothing changes (the whole change is one transaction).

**Rationale**: spec FR-007 to FR-009; one source of truth for capacity.

**Alternatives**: a second capacity count in `workshops` (rejected: it would drift); calling the wrapped public methods in sequence (rejected: not atomic).

## R-04 The calendar interface

**Decision**: `CalendarProvider` in `packages/providers`: `createEvent({ title, start, durationMinutes, attendeeLabels })` returning a provider reference and the confirmed start, and `cancelEvent(ref)`; both return the standard `ProviderResult`. Attendees are passed as **labels only** (a role or a name), never an email, so no personal contact detail leaves the system. A `FakeCalendar` (in memory, scriptable failures and conflicts) ships; **no live adapter** is built (clarified 2026-11-23). Configuration `CALENDAR_PROVIDER` accepts `none` (default) and `fake` (development and tests); a value naming a live provider is refused until one exists.

Booking "via the calendar" first creates the event, then (in one transaction) records the booking and the state move; if the provider fails or conflicts, nothing is recorded and the workshop stays `requested`. A cancel or reschedule asks the provider first and treats a provider failure as a warning that the person must clear by hand (the booking change still happens, with a note that the calendar event needs attention), because capacity must not be held by an event the person cannot remove.

**Rationale**: spec FR-005, constitution XV (provider independence), minimal first version.

**Alternatives**: building the Google adapter now (rejected by the clarification); no interface at all (rejected: the spec requires the seam).

## R-05 Data model in outline

**Decision**: tables `workshop`, `workshop_state_history`, `workshop_participant`, `workshop_artifact`, `workshop_brief`, `workshop_finding`, `workshop_output_document`, `workshop_output_share` and `delivery_effort` in migrations `0023_workshops.sql` and `0024_workshop_findings.sql` (details in [data-model.md](data-model.md)). Histories and shares are append-only with triggers; findings and outputs are editable only while a draft and fixed once finalised or approved; every column is registered in `COLUMN_CLASSIFICATION`.

**Alternatives**: one JSON blob per workshop (rejected: no constraints, no history); separate tables per offer's findings (rejected: the typed JSON per offer is validated by the schema and a single table keeps versioning uniform).

## R-06 The typed findings and their rules (pure)

**Decision**: Zod schemas and pure rules in `packages/domain/src/workshops/findings.ts`, table-tested:

- **Offer 1** (`schema_version` 1): `flowSummary` (≤ 1,000), `delaySources` (**at most 3**), each `{ description (≤ 300), ownerClass: operator | sender | rule_owner, delay: { kind: "quantified", amount (> 0), unit: hours | days | weeks } | { kind: "not_quantified" }, confirmation: confirmed | not_confirmed | unknown }`, `unknowns` (≤ 10 × 300), `suggestedNextStep` (≤ 500), `boundaryNote` (≤ 600, required and fixed-prefixed by the standard boundary sentence).
- **Offer 6** (`schema_version` 1): `fields`, exactly the ten names of the intake in order, each `{ name, sourceSystem (≤ 120), sourceInterface (≤ 120), observations: { quality, completeness, freshness, provenance, access } }` where each observation is `{ status: known_good | gap | unknown, note (≤ 300) }`; `overall: { view: go | no_go | conditional, dependsOnUnknowns: string[], reason (≤ 500), }`; the disclaimer is a fixed constant stored by value; `inputAuditScope: { useCase (≤ 200), sources: 1 or 2 × ≤ 120 }`.
- `finalisable(findings)` returns the list of shortfalls: fewer than three delay sources, a source with no owner class, fewer than ten fields, a field with an unset observation, a `go` view with any `unknown` and no reason, no scope. A shortfall that the spec allows a reason for (fewer sources or fields) is cleared by a recorded `waiverReason` (≥ 10 characters), stored on the finalised row; the others are never waivable.
- `unknown` is a distinct status everywhere. A pure `summarise(fields)` returns counts of `known_good`, `gap`, `unknown` and **never** merges unknown into gap; a test scans the output template and the summary for the words "gap" or "fail" near an unknown count.
- The economic buyer, funding path and any qualification wording are not fields. A schema key scan (as in 006) refuses `price`, `budget`, `fee`, `guarantee`, `qualified` and similar.

**Rationale**: spec FR-018 to FR-028, constitution IX.

**Alternatives**: free text findings (rejected: not testable); letting the model choose a status (forbidden).

## R-07 Findings versions

**Decision**: `workshop_finding` rows are `(workshop_id, version_no)`. The current version is a **draft** that can be edited in place (optimistic `lock_no`) until a person finalises it; finalising sets `finalised_by`, `finalised_at` and the optional `waiver_reason` and fixes the row (a trigger refuses any later change of content). A correction after finalisation inserts the next version as a new draft with a required reason, copying the content; the earlier versions stay readable. The workshop moves to `findings_recorded` on the first finalisation; later versions do not move its state.

**Alternatives**: edit in place with a history table (rejected: harder to prove the finalised text never changed).

## R-08 The preparation brief: a pure baseline first, a model second

**Decision**: a pure function `baselineBrief(input)` builds the brief with **no model**: records with status `observed` or `buyer_confirmed` become confirmed facts (tied to their evidence id), derived or AI-sourced ones become inferences, missing items become unknowns (for example "no economic buyer recorded", "no spec shared yet"), a fixed question list per offer (hypothesis, from the offer's intake fields) and the artifact checklist from a configured list. This is also the **checklist-only** fallback (spec FR-013).

With `WORKSHOP_AI=on` a model **improves** the baseline. The contract `workshop-preparation-brief@1.0.0` returns `confirmedFacts[{ statement, evidenceIds[] }]`, `inferences[{ statement, basis }]`, `unknowns[]`, `suggestedQuestions[]`, `artifactChecklist[{ kind, why }]`. The service **verifies** it: every `evidenceIds` entry must be one of the ids sent in; a confirmed fact with no valid id, or with an id whose status is not `observed` or `buyer_confirmed`, is **moved to inferences**; a checklist kind outside the configured list is dropped; any statement that trips the PHI guard refuses the whole brief and falls back to the baseline. No text from the model changes any state.

**Rationale**: spec FR-010 to FR-013, constitution I, II, IX, X.

**Alternatives**: model only (rejected: no fallback and no way to prove unsupported facts are not stated); baseline only (rejected: the spec asks for an assisted brief).

## R-09 AI contracts, gateway input and cost

**Decision**: two contracts in `packages/ai-contracts`: `workshop-preparation-brief@1.0.0` (prompt `workshop-brief`) and `workshop-findings-draft@1.0.0` (prompt `workshop-findings`), both `synthesis` tasks with context type `other` (the existing constraint allows both, so no `ai_invocation` rebuild, as in 006). The gateway's `ModelInput` allow-list gains two keys: `workshop` (typed ids, the offer key, intake answers and evidence records as **data blocks**, never instructions) and `notes` (the operator's pasted notes, one data block). Both pass the gateway's PHI pre-flight, the budget check (per call `WORKSHOP_AI_CAP`, default the interpretation cap, plus the account's monthly allowance read the same way research does), schema validation and one `ai_invocation` row per attempt with no text stored.

The notes-assist (`workshop-findings-draft`) returns items each with `supportingText`, which the service checks is a **substring of the notes** (after the normalisation research uses); an item without it is dropped. It can only fill, for Offer 1, delay sources, flow summary, unknowns and next step; for Offer 6, source systems, interfaces and statuses for **field names that are in the intake list**. Anything not found stays empty or `unknown`. The result is returned to the screen as a **suggestion and is not stored**; only the operator's save writes a draft.

**Rationale**: spec FR-029, constitution X, XI.

**Alternatives**: store suggestions (rejected: invites treating them as findings); a new ai task value (rejected: forces a table rebuild).

## R-10 Artifacts, uploads and the PHI boundary

**Decision**: an artifact has a **kind** from the configured allow-list (`specification`, `timeline`, `scrubbed_rejection_log`, `interface_description`, `field_list`, `other_non_phi`), a title, a reference, and optionally stored text content.

- A **reference** (a URL or a document name) is checked as free text and recorded.
- **Text content** (`.txt`, `.md`, `.csv`, `.json`, `.log`, up to `WORKSHOP_ARTIFACT_MAX_BYTES`, default 1 MiB) arrives as UTF-8 text in the request, goes through the guard at the **`upload` entry point**, and if clean is stored through the file provider with a content hash. **Binary formats (PDF, Word, images) are not kept**: their content cannot be checked, so only a reference is recorded. This is stated in the form and in the response.
- The route sets `skipPhiGuard` and runs the guard itself, so an upload that trips the guard is **held** (the existing `upload` entry point policy, quarantine on for this route, configurable) instead of rejected: the content is encrypted in the quarantine store (never in the workshop tables), the artifact row is `held` with the quarantine item id and rule ids only, the existing operator alert (`operator.alert.phi`) is raised, and an audit event records the hold without content. The title and other fields are guarded as `api_body` and a hit refuses the whole entry. A held artifact is **released** or **discarded** through the existing quarantine routes by `quarantine.review`, after which the workshop service rechecks and either keeps (released) or marks it discarded.
- If the guard cannot run, the entry is refused.
- The checklist shows each expected kind as `received`, `held` or `not_received`; a missing artifact never blocks anything.

**Rationale**: spec FR-014 to FR-017, Scenario D, constitution IV.

**Alternatives**: accept any file and scan asynchronously (rejected: content would exist unchecked); reject instead of hold (rejected: the spec asks for quarantine and an alert).

## R-11 File storage grows a write side

**Decision**: feature 006's `FileStorageProvider` only reads and signs. Add `put(key, bytes, contentType)` and `delete(key)` to the interface, the fake and the local-disk adapter (same safe-key rule, atomic write, no overwrite without `overwrite: true`). Keys are `workshop-<workshopId>-<kind>-<id>.<ext>`. Reads for operators go through an **authenticated** route that streams the file; no signed public link is used for artifacts or outputs.

**Alternatives**: a second storage provider (rejected: same need, one interface).

## R-12 The buyer output and its PDF

**Decision**: the output is structured content, not free HTML. `workshop_output_document` stores a revision's `sections` (JSON: title, the buyer's organisation, the offer name, the date, the findings summary text, an unknowns text, the suggested next step, `inScope` and `outOfScope` lists, the boundary note and, for Offer 6, the fixed disclaimer). A **pure template** (`packages/domain/src/workshops/output.ts`) builds the first draft from finalised findings and a **pure renderer** turns sections into HTML. The operator edits the section texts (not their structure); each edit is a new revision row.

Approval is gated by pure checks, all table-tested: `inScope` and `outOfScope` non-empty; the Offer 6 disclaimer present and unmodified; total length within the one-page budget (`OUTPUT_MAX_CHARS`, 3,500, a hypothesis); no price pattern; `checkText` from feature 005 finds no restricted wording that is not covered by an approved claim; no `unknown` shown as a gap or `not_confirmed` shown as confirmed (the renderer is the only place those labels are produced, and a test proves it). Approval needs `workshops.output.approve` (R-15) and renders the PDF; the PDF is stored via the file provider with its hash and a **page count of exactly one** (the real renderer reports pages; the fake counts by the character budget). A render failure or more than one page refuses approval with a plain message and leaves the draft.

`PdfRenderer` is a provider interface (`render(html) → { bytes, pages }`) with a `FakePdfRenderer` and a Playwright adapter (`playwright-core`, Chromium, `page.pdf`), selected by `PDF_RENDERER` (`fake` by default in development and tests, `playwright` in production). The adapter is the one new runtime dependency and needs the Chromium binary installed (documented in the quickstart and ADR-021). The HTML is built from escaped text only and loaded with scripts and network disabled.

Sharing records who, when and how (`handed_over`, `copied_link`, `other`) in the append-only `workshop_output_share`; nothing is sent. When a later findings version exists, the output is **out of date** (computed at read from the findings version it was built from) and cannot be shared again until a new draft is approved.

**Alternatives**: free-form HTML edited by the operator (rejected: cannot guarantee the scope section or the disclaimer); a pure-JavaScript PDF writer (kept as the fallback if the browser dependency proves too heavy; the interface allows it); a Word document (rejected by the clarification).

## R-13 Delivery effort

**Decision**: `delivery_effort` is append-only: `prep_hours` (0 to 80, step 0.25), `session_hours` (0 to 24), `people` (1 to 20); the current entry is the latest. The summary per offer returns the count of workshops with effort, totals, averages, the count missing, and the offer's recorded effort estimate text, labelled `hypothesis`.

## R-14 The workspace API in outline

**Decision**: one contract [`contracts/workshops.openapi.yaml`](contracts/workshops.openapi.yaml) with 25 operations over 18 paths: conversion and listing, one `transition` action endpoint, participants, artifacts, the brief, findings (draft, finalise, suggest), the output (generate, edit, approve, share, PDF) and effort. Mutations need an `Idempotency-Key`. A model call (brief, suggest) is asynchronous only in the sense of a normal request; no job is needed (the gateway call is bounded by its cap and timeout).

## R-15 Permissions

**Decision** (hypothesis, open question #53): `workshops.read`, `workshops.edit` (convert, book, change state, participants, artifacts, brief, findings drafts and finalisation, effort, share) and `workshops.output.approve` (restricted, people only). Mapping: `gtm_operator` gets read and edit; `research_analyst` and `read_only_executive` get read; `sales_service_lead` gets read, edit and approve; `administrator` gets everything; `technical_sme_reviewer` gets read. Releasing or discarding a held artifact uses the existing `quarantine.review`. Offers' `offers.bookings.edit` is **not** needed for a workshop booking.

## R-16 Events

**Decision**: `workshop.requested` (on conversion), `workshop.booked` (including a reschedule, with `reschedule: true`), `workshop.held` and `workshop.findings_recorded` (first finalisation). Payloads carry identifiers and the offer id only (`workshop_id`, `offer_id`, `request_id`, plus `reschedule` and `version_no`); strict schemas in `packages/domain/src/events/feature007.ts`. No name, note, finding, artifact title or text appears in an event. Cancel, no-show, close, artifact, output and effort changes are audited only.

## R-17 Retention

**Decision**: a daily worker job `workshops.retention` (registered with the others, off until `WORKSHOP_RETENTION_JOB_ENABLED=true`) deletes artifact and output files for workshops whose `closed_at` is more than `WORKSHOP_RETENTION_MONTHS` (default 12) in the past, sets `file_deleted_at` on their rows, and audits each deletion without content. Metadata, findings and the audit trail stay. Held artifacts follow the quarantine hold period. A cancelled or no-show workshop counts from its final state time.

## R-18 Configuration

**Decision** (all hypotheses): `CALENDAR_PROVIDER` (`none`), `WORKSHOP_AI` (`off`), `WORKSHOP_AI_CAP` (the interpretation cap, 0.20), `PDF_RENDERER` (`fake`), `WORKSHOP_ARTIFACT_MAX_BYTES` (1,048,576), `WORKSHOP_ARTIFACT_KINDS` (the list in R-10), `WORKSHOP_UPLOAD_QUARANTINE` (`true`), `WORKSHOP_RETENTION_MONTHS` (12), `WORKSHOP_RETENTION_JOB_ENABLED` (`false`), `OUTPUT_MAX_CHARS` (3500) and the session lengths (45 and 90 minutes, read from the offer snapshot's `format` when it states them, else these defaults).

## R-19 Screens

**Decision**: a **Workshop Workspace** at `/workshops/[id]` with panels for the intake, participants, the booking and state moves, the brief, the artifact checklist, notes, the findings editor for the offer (a structured editor each for Offer 1 and Offer 6, with a "suggest from my notes" control that fills the form without saving), and the output preview and approval; a list page at `/workshops`; a "Convert to workshop" action on the request inbox's request detail. Controls appear only for holders of the permission; the API enforces every permission. The Playwright run on request gains Scenario A and B steps for the workspace.

## R-20 Migrations and data classification

**Decision**: forward-only `0023_workshops.sql` and `0024_workshop_findings.sql`. Notes, findings, brief text, output text and artifact titles are `confidential_commercial`; participant names and roles are `business_contact`; identifiers, states and timestamps are `sensitive_operational_metadata`. Quarantined content is never stored in these tables.
