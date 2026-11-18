# Implementation Plan: Signals and Evidence

**Branch**: `003-signals-evidence` | **Date**: 2026-11-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-signals-evidence/spec.md` (clarified 2026-11-17)

## Summary

Deliver the provenance-first evidence layer: a versioned signal taxonomy (categories A–I), a registry of signal sources with storage rules, signals recorded with full provenance and a mandatory source, de-duplication that merges near-duplicates (and the same item from two sources) into one signal with a provenance chain, human review (approve, reject, mark contradictory, re-verify), deterministic freshness and a "current evidence" rule, funding-context and regulatory context-only rules, and excerpt/"no storage" limits. A filterable Signal Feed and an account signal timeline sit on top. Signals are observations only: nothing here sets ICP fit, hypotheses, funding path or buyers.

Technical approach (details in [research.md](research.md)): follow the Feature 001 and 002 architecture. One new module `signals` in `apps/api`, pure rules in `packages/domain/src/signals`, persistence on the interim SQLite adapter behind `Tx` (ADR-015) with forward-only migrations `0011`–`0013`, audit in the same transaction as every state change, events through the transactional outbox, and the PHI guard applied to every text field. Departures from the runbook's plan prompt, all forced by ADR-015 or by naming and all reversible: (1) freshness is stored as a `fresh_until` date and `is_current` is computed at read time, with an optional scheduled job that only materialises a stale flag (no generated column and no pg-boss); (2) the polymorphic link table is named `signal_link`, because `evidence_reference` already exists from feature 002; (3) the event `signal.normalized` is not emitted, because normalisation is part of recording here (a `signal.reviewed` event is added instead); (4) the taxonomy seed uses the hypothesis types in the spec, since source §8.1 is not in the repository (open question #35).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged)

**Primary Dependencies**: no new runtime dependencies. Fastify 5 + zod-to-openapi, Zod 4, `node:sqlite` via `@gtm/db`, uuid v7, Next.js 15 / React 19. Text similarity reuses the trigram Sørensen–Dice approach already built for organisation names.

**Storage**: interim SQLite (ADR-015); migrations `0011_signal_taxonomy.sql`, `0012_signals.sql`, `0013_signal_review.sql`; every new column registered in `COLUMN_CLASSIFICATION`. Postgres migrations stay deferred with the ADR-015 list.

**Testing**: Vitest (unit, integration, contracts). Table-driven tests for dedup, freshness, funding and regulatory rules; OpenAPI contract tests with the existing helper; Testing Library for the feed and timeline; an end-to-end test over the synthetic fixtures, including `lakeshore-hie` conflicting evidence.

**Target Platform**: Linux (same containers as 001/002).

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: any combination of feed filters returns in under 2 seconds with 10,000 signals (SC-010); a reviewer can find and decide a signal in under 1 minute; recording a signal is a single transaction.

**Constraints**: non-PHI business data only; every text field passes the PHI guard before storage; no AI in any rule (dedup, freshness, funding, regulatory, current-evidence); a signal's observation, excerpt, account, type and dates never change after insert (only review state, flags and provenance grow); no column can express funding path, fit, hypothesis or intent.

**Scale/Scope**: tens of thousands of signals over low-thousands of accounts; 3 new REST areas; 2 UI pieces (feed, account timeline); 2 events.

Numeric defaults (similarity 0.85, excerpt 300 characters, retention 36 months, per-type freshness windows) are hypotheses, configurable, listed in research R-16.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | This feature *is* the evidence layer. A signal never concludes; supporting and contradictory lists are always present (`signal_link`, possibly empty). | Pass |
| II | Buyer-confirmed vs assumption | One evidence status per signal; a DB trigger and the service refuse `buyer_confirmed` unless the actor is human and the method is manual; repetition and merging never upgrade status. | Pass |
| III | Provenance | All provenance fields stored; append-only provenance chain; taxonomy version, model and prompt version recorded; excerpts length-limited and withheld by source rule. | Pass |
| IV | Non-PHI by default | PHI guard on excerpt, observation, source ref, notes and review reasons before anything is stored, logged or echoed; refusals audited with rule IDs only. | Pass |
| V | No unsupported claims | Regulatory signals are context-only with a re-verify flag; no compliance statements; HTI-5 never final. | Pass |
| VI | ICP focus | Signals do not alter ICP fit; relevance tags are advisory and never read by the evaluator. | Pass |
| VII | Buyer value over volume | n/a. | n/a |
| VIII | Human approval | Only human reviewers approve; AI and provider actors can submit only as pending. | Pass |
| IX | Deterministic rules | Dedup, freshness, funding class, regulatory status and current-evidence are pure code in `packages/domain/src/signals` with unit tests; boundary lint keeps them free of provider/AI imports. | Pass |
| X | Structured AI outputs | AI-extracted signals record model and prompt version; the ingest function validates against a Zod schema; no reasoning traces stored. | Pass |
| XI | Untrusted input | Source text is data; the observation is stored as text only and never interpreted; ingest from providers goes through the same validation. | Pass |
| XII | Explainable | Each signal shows why it counts or not (approved, fresh/stale, flagged). | Pass |
| XIII | Capacity | n/a. | n/a |
| XIV | Privacy and minimisation | Contact link optional and cleared on erasure; excerpts minimised and capped. | Pass |
| XV | Provider independence | Providers submit through the internal ingest function; no vendor SDKs; a fake provider test. | Pass |
| XVI | Modular monolith | New `signals` module with a public index; other modules read through it or react to events. | Pass |
| XVII | Test before autonomous action | Test-first tasks for every rule; scenario A evidence steps use the fixtures. | Pass |
| XVIII | Hypotheses labelled | Taxonomy defaults, windows, thresholds, per-source defaults carry `status_label = hypothesis` and a visible UI label. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotent handlers, correlation IDs, redacted logs | Same mechanisms as 001/002. | Pass |
| Security baseline | RBAC, audit every change, encryption | New permissions (R-12); audit in-transaction incl. refusals. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` | Domain additions covered by table-driven tests. | Pass |

**Gate result (pre-research)**: PASS. No violations; Complexity Tracking is empty.

**Post-design re-check**: PASS. Three interpretations are flagged for confirmation: unknown sources entered inline are created citation-only until an administrator allows excerpts (R-09); the freshness anchor is the published date, else the collected date (observed date for first-party types) (R-06); `signal.normalized` is replaced by `signal.reviewed` (R-13).

## Project Structure

### Documentation (this feature)

```text
specs/003-signals-evidence/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: tables, constraints, state transitions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── signals.openapi.yaml
│   └── sources.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/domain/src/signals/
├── taxonomy.ts          # categories A–I, kinds, seed types (hypothesis) and version helpers
├── normalise.ts         # observation normalisation, content fingerprint, source-ref canonicalisation
├── similarity.ts        # text similarity (trigram Dice) over normalised observations
├── dedup.ts             # decideDuplicate(new, candidates) -> new | identical | merge(reason)
├── freshness.ts         # freshAnchor, freshUntil, isStale, isCurrentEvidence (pure)
├── funding.ts           # classifyFunding(type, input): context | budget_approval_evidence
├── regulatory.ts        # regulatory status rules, HTI-5 never-final, re-verify flag
├── excerpt.ts           # effective excerpt limit (min of global, source), withheld reason
├── review.ts            # review transition rules (pure)
├── validate.ts          # validateNewSignal (source required, dates, actor limits, PHI-guarded text), deriveSensitivity
└── index.ts
packages/ai-contracts/src/signal-extraction.ts   # SignalSubmission schema used by provider/AI ingest
packages/db/
├── migrations-sqlite/0011_signal_taxonomy.sql  0012_signals.sql  0013_signal_review.sql
├── src/seed/feature003.ts                      # taxonomy version 1, default sources (hypotheses)
└── src/classification.ts                       # + all new tables/columns
apps/api/src/modules/signals/
├── repository.ts        # Tx-bound data access (insert, provenance, links, reviews)
├── service.ts           # record, merge, ingest (actor-aware), freshness and retention job bodies
├── review.ts            # approve, reject, contradict, reverify, clear flag
├── sources.ts           # source registry, availability, storage rule, taxonomy publication
├── queries.ts           # feed filters, account timeline, current evidence
├── routes.ts            # REST (contracts/signals + sources)
├── events.ts            # signal.discovered, signal.reviewed
└── index.ts             # public entry: currentEvidence(tx, accountId), recordSignal(...)
apps/api/src/worker/ (register queues signals.freshness, signals.retention — optional)
apps/web/src/app/signals/page.tsx                # Signal Feed
apps/web/src/components/SignalTimeline.tsx       # account timeline, mounted on account detail
apps/web/src/lib/signals-api.ts
tests/fixtures/synthetic-orgs/signals.json       # fixture signals incl. lakeshore-hie conflict
tests/{unit,integration,contracts}/…             # per module, plus an end-to-end fixtures test
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as 001 and 002. The empty `signals` module stub is filled in. No new deployable, package or service. The account timeline is a reusable component because 002's account detail screen is not built yet; it mounts there when that screen exists.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
