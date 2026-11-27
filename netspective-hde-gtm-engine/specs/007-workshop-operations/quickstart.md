# Quickstart: Workshop Operations

A run-and-validate guide. It contains no implementation code. Details live in [contracts/workshops.openapi.yaml](contracts/workshops.openapi.yaml), [data-model.md](data-model.md) and [research.md](research.md).

## Prerequisites

- Features 001 to 006 running locally (interim SQLite, ADR-015), branch `007-workshop-operations`, migrations `0023` and `0024` applied.
- Seeded users: a GTM operator (`gtm_operator`), a service lead (`sales_service_lead`), a reader (`read_only_executive`), a quarantine reviewer (an administrator) and the existing roles.
- Synthetic organisations from `tests/fixtures/synthetic-orgs/` imported with their evidence; one linked Offer 1 intake request for `northvale-hie` and one linked Offer 6 intake request for `riverbend-health` (ten field names, no values), created through the feature 006 forms and reviewed.
- Fake providers: the fake model, the fake calendar (`CALENDAR_PROVIDER=fake`) and the fake PDF renderer (`PDF_RENDERER=fake`). The Google Calendar adapter is exercised only with an injected `fetch` (no network); switching it on for real needs `CALENDAR_PROVIDER=google`, `CALENDAR_GOOGLE_ENABLED=true` and its four credentials.

## Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|----------|------------|------------------|------|
| V1 | Convert a request | Convert the Offer 1 request and the Offer 6 request | Two workshops in `requested`, linked to the request, account, contact and intake; nothing sent | FR-001 |
| V2 | Refused conversions | Convert an unlinked request, a request for Offer 5, and a request that already has an open workshop | Each refused with its reason | FR-001 |
| V3 | Book by hand and by calendar | Book one workshop by hand and one with `via: calendar` | Both `booked` with the length (45 and 90 minutes) and a booking row with source `workshop` | FR-004, FR-005 |
| V4 | Calendar failure | Script the fake calendar to fail, then book | The workshop stays `requested`; booking by hand still works | FR-005 |
| V4a | Google adapter | Run the shared provider contract test against the fake and the Google adapter (injected `fetch`: token exchange, free/busy empty and busy, insert, delete, 401, 429, timeout) | Same results from both; a busy slot is a `conflict`; no request carries an `attendees` field or an email and `sendUpdates` is `none`; with the flag off or credentials missing the configuration refuses to start | FR-005 |
| V5 | Lifecycle | Hold, record findings (V15), close; mark another no-show; cancel another; reschedule one | Only permitted moves succeed, each audited with who, when and why; no-show cannot be held; cancelled is final | FR-002, FR-003 |
| V6 | Refused moves | Close a booked workshop; hold a requested one; book a closed one | Each refused with `invalid_transition` and the refusal audited | FR-002, SC-002 |
| V7 | Capacity use and release | Fill Offer 6 for the month, then try to book; cancel one booked workshop and try again | Refused `capacity_exhausted` with the wait-list alternative; the booking succeeds after the cancellation; feature 005's booking routes refuse to change a workshop's booking (`booking_owned_by_workshop`) | FR-007 to FR-009, SC-003 |
| V8 | Reschedule across periods | Reschedule into a full period, then into one with room | The first refused and unchanged; the second moves the place | FR-007 |
| V9 | No limit set | Book an offer with no limit | Allowed, and the answer says no limit is set, not unlimited | FR-008 |
| V10 | Baseline brief | Generate a brief with the model off | Confirmed facts tied to evidence ids, inferences, unknowns, questions and a non-PHI checklist | FR-010, FR-013 |
| V11 | Model brief and unsupported fact | Turn the model on; script an answer citing an unknown id, a non-confirming record and an inference with no evidence | Confirmed facts show only evidence text for valid ids; the evidence-less inference is dropped; contradictory records are listed; a checklist kind outside the list is dropped | FR-011 |
| V12 | Injection and fallback | Put an instruction in the intake text; make the model fail or exceed its cap | The brief is unaffected by the instruction; the baseline is returned with a notice; the workshop is unchanged | FR-012, FR-013 |
| V13 | Artifacts | Record a specification reference, a scrubbed log text, and a file of an unknown kind | The first two are received and on the checklist; the third refused | FR-014, FR-017 |
| V14 | PHI upload (Scenario D) | Record artifacts with an MRN and name, a DOB and name, an SSN and patient rows (the `granite-health` case) | Each is held (202), never stored in the workshop tables, never sent to a model or logged, an operator alert raised (rate-limited) and every hold listed, an audit event written without content; releasing one keeps it held if a rule beyond the released ones matches | FR-015, FR-016, SC-004 |
| V15 | Offer 1 findings (Scenario A) | Save three classified delay sources, unknowns, next step and the boundary note; finalise | Finalised; the workshop moves to `findings_recorded`; the event is published | FR-018, FR-027 |
| V16 | Offer 1 refusals | Finalise with two sources, then four, an unclassified source, no boundary note | Two refused unless a waiver is recorded (then finalised and marked waived); four refused; the others refused | FR-019, SC-005 |
| V17 | Delay confirmation | Mark a delay confirmed, one not confirmed, one unknown | Each stored with who and when; an unconfirmed one is never shown as confirmed; confirming after finalising makes a new version | FR-020 |
| V18 | Offer 6 findings (Scenario B) | Start from a draft with everything not recorded; trace the ten fields with a mix of known good, gap and unknown; set a conditional overall view; draft a scope of one use case and two sources; finalise | Finalised; unknown shown as unknown in the summary and view; the disclaimer is present | FR-022 to FR-026 |
| V19 | Offer 6 refusals | Nine fields, an added eleventh field, a go view hiding unknowns, a scope with three sources or two use cases | Each refused (nine unless waived) | FR-022, FR-024, FR-025, SC-005 |
| V20 | Findings versions | Correct a finalised set | A new version with a reason; the earlier version is unchanged and readable | FR-027 |
| V21 | Notes-assist | Paste session notes and ask for a suggestion | Items with their quoted note text; nothing stored until the operator saves; an item without support, or with a number or name its quote lacks, is dropped; interpretive values need a tick | FR-029 |
| V22 | Injection in notes | Paste notes with an instruction, and with patient-like text | The instruction changes nothing; patient-like text refuses the whole request | FR-012, FR-028 |
| V23 | Value in findings | Save a finding with a sample record or a price | The whole entry refused; nothing stored | FR-028 |
| V24 | Output draft | Generate the output for each offer | A one-page draft with the scope sections and, for Offer 6, the disclaimer; built only from the findings | FR-030 |
| V25 | Approve and share | Edit, ask an operator to approve (refused), approve as the service lead, share | Approved with a one-page PDF; shared once with who, when, how; nothing sent | FR-031, FR-032 |
| V26 | Output gates | Remove the out-of-scope section, try to edit a generated section, add a price, add a guarantee, make it two pages | Each approval refused with its reason | FR-031, SC-007 |
| V27 | Out of date | Correct the findings after approval | The output reads out of date and cannot be shared until a new draft is approved | FR-032 |
| V28 | Effort | Record effort on three workshops of one offer, then a bad figure | The summary shows totals and averages beside the estimate, labelled hypothesis, missing counted as missing; the bad figure refused | FR-033, SC-010 |
| V29 | RBAC | Call each route as a role without the permission | 403 and an audited refusal; an operator cannot approve | FR-035 |
| V30 | Audit and events | Convert, book, hold, finalise | One audit record each; four events with identifiers only and no names, notes or titles | FR-036 |
| V31 | Retention | Close one workshop, cancel another, leave a third untouched, advance 13 months, run the retention job | Artifact and output files deleted, audited without content; metadata and findings stay | FR-038 |
| V32 | Scenarios A, B, D | Run the cross-feature test over the fixtures; run `pnpm test:e2e` (the visitor intake in the browser, the operator steps through the API) | Scenario A from booking to findings and delay confirmation; Scenario B from approval to scope; Scenario D for artifacts | Scenarios A, B, D |

## Run

```bash
cd netspective-hde-gtm-engine
pnpm test                 # lifecycle, findings rules, brief verification, output gates, effort
pnpm test:integration     # workshops, booking and capacity, artifacts, PHI hold, brief, findings, output, RBAC, audit, events
pnpm test:contracts       # the workshops contract
pnpm test:e2e             # Playwright, workspace steps (run on request; needs Chromium installed)
pnpm lint && pnpm typecheck && pnpm format
```

The real PDF adapter is exercised on request with `PDF_RENDERER=playwright` and Chromium installed (`pnpm --filter @gtm/web exec playwright install chromium`); the fake renderer is used everywhere else.

All numeric defaults, the retention period, the one-page budget, the question lists, the role mapping and the text-only upload rule are hypotheses (open question #53).
