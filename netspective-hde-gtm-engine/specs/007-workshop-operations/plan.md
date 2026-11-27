# Implementation Plan: Workshop Operations

**Branch**: `007-workshop-operations` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/007-workshop-operations/spec.md` (clarified 2026-11-23)

## Summary

Turn a linked Offer 1 or Offer 6 request into a workshop and follow it to a reviewed one-page buyer output. A **pure lifecycle** (requested, booked, held, findings recorded, closed, with cancelled, no-show and reschedule) is driven by people; booking reuses feature 005's capacity bookings **in the same transaction**, so a place is counted and released exactly with the workshop's state. A **preparation brief** is built first by a pure baseline from the intake and the account's evidence and may be improved by a schema-checked model call that can only restate what the evidence supports. **Artifacts** are non-PHI references or text, checked at the upload entry point; anything that looks like PHI is held, never stored or sent to a model, and the operator is alerted. **Typed findings** per offer (three classified delay sources for Offer 1; ten traced fields with known-good, gap or unknown for Offer 6) are finalised by a person under pure rules, and a model may only suggest a draft from the operator's pasted notes, with every item tied to quoted note text. A **buyer output** is built from the finalised findings, always carries an in-scope and an out-of-scope section, is edited as revisions, approved by a person who holds a new approval right, and rendered to a fixed one-page PDF; sharing is recorded and nothing is sent. Delivery effort is recorded to test the effort hypotheses.

Technical approach (details in [research.md](research.md)): follow the feature 001 to 006 architecture. All behaviour lands in the `workshops` module, with pure rules in `packages/domain/src/workshops`, persistence on the interim SQLite adapter behind `Tx` (ADR-015) with forward-only migrations `0023` and `0024`, audit in the same transaction as every change, events through the outbox, and the PHI guard on every text.

**Important decisions and departures**: (1) feature 005's `BookingService` gains transaction-level methods so a workshop's state change and its capacity change commit together, and its public methods refuse to change a workshop's booking, so the two cannot drift (R-03); (2) the preparation brief has a no-model baseline that is also the fallback, and the model can never turn an unsupported statement into a confirmed fact (R-08); (3) the notes-assist is returned as a suggestion and **not stored**, and each item must quote the notes (R-09); (4) uploads accept **text only**, because binary content cannot be checked, and a hit is **held** through the existing quarantine, not rejected (R-10); (5) `FileStorageProvider` gains `put` and `delete` (R-11); (6) the PDF is made from structured sections by a `PdfRenderer` interface with a fake and a Playwright adapter, which adds `playwright-core` and needs the Chromium binary in the deployed image (R-12); (7) there is a calendar interface, a fake, and an optional Google Calendar adapter that is off by default, sends no invitation and is tested without a network (R-04); (8) three permissions are added, one of them restricted (R-15); (9) the business source sections, every threshold, the retention period and the role mapping are hypotheses (open question #53).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged)

**Primary Dependencies**: Fastify 5 + zod-to-openapi, Zod 4, `node:sqlite` via `@gtm/db`, uuid v7, Next.js / React for the screens. **New**: `playwright-core` (providers package, the PDF adapter only). The Google Calendar adapter uses `fetch` and adds no dependency. `@playwright/test` from feature 006 is reused for the browser test.

**Storage**: interim SQLite (ADR-015); migrations `0023_workshops.sql`, `0024_workshop_findings.sql`; triggers refuse UPDATE and DELETE on the append-only tables in [data-model.md](data-model.md); every new column registered in `COLUMN_CLASSIFICATION`. Artifact files and output PDFs live in the file provider; held content lives in the encrypted quarantine store.

**Testing**: Vitest (unit, integration, contracts). Table-driven tests over the lifecycle, the findings rules (`finalisable`, waivers, unknown-not-gap), the output gates and the brief verification; the gateway with the fake model for the brief and the notes-assist (model wording never appears as a confirmed fact, an inference without evidence is dropped, an item without quoted support is dropped, a prompt-injection string has no effect); the booking and capacity behaviour through the real `BookingService`; artifact upload with the PHI fixtures (`tests/fixtures/phi-samples`); the PDF renderer with the fake always and the real Chromium adapter on request; OpenAPI contract tests with the existing helper; Testing Library for the workspace; the always-on Scenario A, B and D integration test; Playwright steps for the workspace run on request.

**Target Platform**: Linux (same containers as 001 to 006). One new scheduled job (retention), off by default.

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: a workshop read, a findings save and a transition each under 300 ms; a baseline brief under 1 second; a model brief or suggestion within its call timeout (30 seconds); approval including the PDF under 5 seconds; recording findings and generating the output under 20 minutes of operator time (spec SC-009).

**Constraints**: non-PHI business data only (the guard on every text, uploads checked at the upload entry point, a refusal stores nothing); no model call in any state, finalisation, approval, capacity, PHI or eligibility decision; the model only drafts (brief, suggestion) and nothing it returns is stored as a finding; no message of any kind is sent; findings, outputs and briefs carry no price, budget or guarantee; unknown is never shown as a gap; events carry identifiers only.

**Scale/Scope**: a few workshops a week; 2 offers; 9 new tables; 26 operations over 19 paths; 4 events; 3 permissions; 1 workspace and 1 list page; 2 AI contracts; 2 provider interfaces (calendar with a fake and a Google adapter, PDF) and a write side on file storage.

Numeric defaults (session lengths 45 and 90 minutes, the 1 MiB artifact limit, the 3,500-character one-page budget, 12-month retention, the model cap) are hypotheses, configurable, listed in research R-18 and open question #53.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | A brief states a fact as confirmed only with an evidence id of status observed or buyer confirmed; anything else is an inference or an unknown. | Pass |
| II | Buyer-confirmed vs assumption | Each delay source carries a confirmation status; an unconfirmed item is never shown as confirmed, in the findings or the output. | Pass |
| III | Provenance | State history, brief model and prompt version, finding versions, approvals, shares and effort entries record who, when and why. | Pass |
| IV | Non-PHI by default | Every text passes the guard; uploads are text only, checked at the upload entry point and held on a hit; held content is encrypted and never reaches a model or a log. | Pass |
| V | No unsupported claims | The output cannot be approved with restricted wording not covered by an approved claim, a price, or a missing scope section. | Pass |
| VI | ICP focus | Only Offer 1 and Offer 6 requests can become workshops. | Pass |
| VII | Buyer value before volume | The output states what is and is not covered; nothing is sent; the boundary note keeps the free diagnosis distinct from paid work. | Pass |
| VIII | Human approval | Every state move, finalisation, approval and share is a person's act; the output needs a restricted approval right. | Pass |
| IX | Deterministic rules | Lifecycle, capacity, findings rules, waivers, output gates and the PHI checks are plain code with table tests; the model decides nothing. | Pass |
| X | Structured AI outputs | Two schema-validated contracts; an invalid or unsupported answer falls back to the baseline or is dropped. | Pass |
| XI | Untrusted input | Intake, evidence and pasted notes are data blocks; a test with injection strings proves they change nothing. | Pass |
| XII | Explainable | Each brief item cites its evidence; each suggested finding quotes its note text; every refusal lists its shortfalls. | Pass |
| XIII | Capacity first-class | Booking counts one place and cancelling releases it, atomically; a full offer is refused with the wait-list alternative. | Pass |
| XIV | Privacy and minimisation | Participants by name and role only, attendee labels only to a calendar; events and logs carry identifiers only; files expire after 12 months. | Pass |
| XV | Provider independence | Calendar, PDF rendering, file storage and the model sit behind interfaces with fakes. | Pass |
| XVI | Modular monolith | Other modules are reached only through their public indexes (R-01); no cycle with `engagement`. | Pass |
| XVII | Test before autonomous action | Rules and the state machine are test-first; the model is never autonomous. | Pass |
| XVIII | Hypotheses labelled | Session lengths, limits, budgets, retention, role mapping, the question lists and the effort estimates are labelled hypotheses. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotent handlers, correlation IDs, redacted logs | Same mechanisms. | Pass |
| Security baseline | RBAC, audit every change, TLS | 3 new permissions; audit in-transaction including refusals; authenticated file reads, no public link. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` | New pure code covered by table tests. | Pass |

**Gate result (pre-research)**: PASS, with the browser dependency, the booking refactor and the file-store write side recorded under Complexity Tracking.

**Post-design re-check**: PASS. Items flagged for confirmation (open question #53): the retention period, the role mapping, text-only uploads, the model default off, the PDF dependency, the one-page budget and the session lengths.

## Project Structure

### Documentation (this feature)

```text
specs/007-workshop-operations/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 to R-20
├── data-model.md        # Phase 1: tables, typed content, states, events, permissions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/
│   └── workshops.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

### Source Code (repository root)

```text
packages/domain/src/
├── workshops/{lifecycle,findings,brief,output,effort,artifacts}.ts   # pure rules and schemas (alongside intake.ts, forms.ts)
└── events/feature007.ts                                               # strict event payloads
packages/ai-contracts/src/
├── workshop.ts                                                        # preparation brief and findings draft schemas
└── prompts/{workshop-brief,workshop-findings}.md
packages/providers/src/
├── interfaces/{calendar,pdf-renderer}.ts   (+ put and delete added to interfaces/file-storage.ts)
├── fakes/{calendar,pdf-renderer}.ts        (+ fakes/file-storage.ts)
└── adapters/{google-calendar,playwright-pdf}.ts   (+ adapters/local-file-storage.ts)
packages/db/
├── migrations-sqlite/0023_workshops.sql  0024_workshop_findings.sql
└── src/classification.ts
apps/api/src/modules/
├── workshops/{repository,lifecycle-service,participants,artifacts,brief,findings,suggest,output,effort,retention,events,routes}.ts   # + intake.ts and index.ts exist
├── offers/bookings.ts                    # tx-level methods; workshop bookings protected
├── engagement/                           # + loadRequestForWorkshop (read-only export)
├── icp/                                  # + evidenceFor export
└── providers/llm-gateway.ts              # ModelInput gains `workshop` and `notes`
apps/api/src/{workshops-stack.ts,app.ts,config/index.ts,worker/}   # composition, config, retention job
apps/web/src/
├── app/workshops/{page.tsx,workshops-view.tsx}
├── app/workshops/[id]/{page.tsx,workshop-workspace.tsx,findings-offer1.tsx,findings-offer6.tsx,output-panel.tsx}
├── app/requests/requests-view.tsx        # + "Convert to workshop"
└── lib/workshops-api.ts
apps/web/e2e/workshop.spec.ts             # run on request
docs/adr/ADR-021-workshop-findings-and-output.md
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as 001 to 006. `workshops` is filled in; `offers`, `engagement`, `icp` and `providers` gain only the small additions listed. Public functions later features call: the workshop reads and the findings (feature 008 qualification reads finalised findings and confirmations) and the effort summary (feature 012 analytics).

## Dependencies and ordering

- **Feature 006**: converts its linked `offer_request` and reads its `intake_submission`. **Feature 005**: bookings, capacity, offer snapshots and the claims checker. **Feature 004 and 003**: hypotheses and signals feed the brief. **Feature 001**: quarantine, the PHI guard, the gateway and the audit trail.
- **Order**: pure rules and their tables first (lifecycle, findings, output gates), then the booking additions, the workshop service and routes, then artifacts and the file write side, then the brief and the gateway keys, then findings and the notes-assist, then the output and the PDF, then effort and retention, then the screens and the scenario tests.
- Feature 008 (qualification) will read the finalised findings and the delay confirmations; feature 009 will send invitations, reminders and the output; feature 012 will read the effort summary.

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| Transaction-level booking methods in feature 005 | A workshop's state and its capacity must commit together | Calling the public methods in sequence is not atomic; a second capacity count would drift |
| A Playwright PDF adapter (`playwright-core`) and a Chromium binary in the image | The runbook asks for a print-quality one-page PDF and a real renderer proves the one-page rule | A pure-JavaScript writer is the fallback behind the same interface if the browser proves too heavy; the fake renderer keeps tests fast |
| `put` and `delete` on the file provider | Artifacts and PDFs must be stored and then expire | A second storage provider would duplicate the interface |
| A Google Calendar adapter, off by default | The plan input asks for it behind a flag; booking by hand and the fake never need it | No adapter would leave the interface untested against a real provider shape; the adapter uses `fetch` so no SDK is added |
| A held-upload path through the existing quarantine | The spec asks for quarantine and an alert, not rejection | Rejecting would lose the reviewer's chance to release a false positive |
