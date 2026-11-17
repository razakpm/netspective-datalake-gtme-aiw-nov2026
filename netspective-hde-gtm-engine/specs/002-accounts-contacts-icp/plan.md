# Implementation Plan: Accounts, Contacts, Stakeholders and ICP Fit

**Branch**: `002-accounts-contacts-icp` | **Date**: 2026-11-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/002-accounts-contacts-icp/spec.md` (clarified 2026-11-16)

## Summary

Deliver the first business capability on the foundation: CSV import of organisations and contacts with row-level validation reports and idempotent re-import; human-reviewed duplicate resolution (never automatic merge); contacts with a lawful source and permitted-use basis; separate title / inferred / confirmed stakeholder roles with evidence-gated "economic buyer"; a deterministic, explainable ICP fit evaluator (pure function) over versioned ICP definitions; excluded-type handling with versioned administrator overrides; and immediate, durable suppression with a single eligibility check for later features. Four minimal operator screens sit on top.

Technical approach (details in [research.md](research.md)): follow the Feature 001 architecture exactly — three new modules (`accounts`, `contacts`, `icp`) in `apps/api`, pure rule code in `packages/domain`, persistence on the interim SQLite adapter behind `Tx` (ADR-015), imports as idempotent jobs on the existing job queue, audit in the same transaction as every state change, events through the transactional outbox. Two deliberate departures from the runbook's plan prompt, both forced by ADR-015 and both reversible: (1) `pg_trgm` is replaced by a pure in-code trigram similarity function in `packages/domain` (a Postgres `pg_trgm` prefilter can be added later without changing results); (2) `communication_preference` is not built, because consent and preference management is out of scope in the spec (feature 009) — suppression covers this feature.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged from 001)

**Primary Dependencies**: no new runtime dependencies. Fastify 5 + zod-to-openapi (REST and OpenAPI), Zod 4 (validation), `node:sqlite` via `@gtm/db`, uuid v7, Next.js 15 / React 19 (web). CSV parsing is a small dependency-free RFC 4180 parser in `packages/domain` (research R-04).

**Storage**: interim SQLite (ADR-015); new forward-only migrations `0007`–`0010` in `packages/db/migrations-sqlite/`; every new column registered in `COLUMN_CLASSIFICATION`. Postgres migrations remain deferred with the rest of ADR-015's list.

**Testing**: Vitest (unit, integration, contracts projects). Table-driven evaluator tests over the 9 organisation fixtures (the 10th fixture is a contact; `granite-health` is import-only); property-style tests for CSV parsing and similarity; OpenAPI contract tests with the existing `openapi-contract` helper; Testing Library for the four screens; an end-to-end integration test importing all fixtures and asserting ICP outcomes.

**Target Platform**: Linux (same containers as 001); local run via the existing one-command setup.

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: import of 500 organisations validated and reported in under 5 minutes end to end (SC-004; expected seconds); merge review readable in under 2 minutes (SC-012); suppression visible to the very next eligibility check (SC-009, same transaction, no cache).

**Constraints**: non-PHI business data only; no real prospect data in the repository; a PHI-like row is rejected and never stored, logged or echoed; no AI in any rule (similarity, eligibility, suppression, assessment); evaluator is deterministic and side-effect free; audit event for every state change and refusal.

**Scale/Scope**: tens to low thousands of accounts and contacts; files up to 5,000 rows / 5 MB (hypothesis, configurable); 4 screens; 7 REST areas; 3 events.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | Each criterion result in an assessment carries evidence references and an explicit contradictory-evidence list (may be empty, always present). Assessments without evidence refs are only allowed for `unknown`/`excluded`-by-type, whose "evidence" is the recorded account attribute itself. | Pass |
| II | Buyer-confirmed vs assumption | Title, inferred role, confirmed role stored in separate columns. Confirmed `economic_buyer` requires ≥1 linked evidence reference with status `buyer_confirmed`; enforced in domain function and by a database CHECK/trigger. AI actors cannot set confirmed roles (restricted permission). Title never populates buyer fields. | Pass |
| III | Provenance | Contacts carry source + basis; evidence references record what/where/when/who/status; imports record file hash and run. Full signal provenance is feature 003. | Pass |
| IV | Non-PHI by default | Import rows pass the 001 PHI guard before any storage; rejected rows store only a row number and rule IDs. Raw files are never persisted (hash only). | Pass |
| V | No unsupported claims | No outward content. | n/a |
| VI | ICP focus | Excluded types enforced in the evaluator; overrides are versioned, rationale-required, admin-only; ICP definitions versioned with explicit activation. A fixture test proves `helixbio` is never priority-eligible. | Pass |
| VII | Buyer value over volume | n/a (no volume metrics). `unknown` is a first-class status. | Pass |
| VIII | Human approval | Merges and conflict resolutions require a human decision; AI cannot override suppression or exclusion; override/activation restricted to administrators. | Pass |
| IX | Deterministic rules | Evaluator, similarity, eligibility, suppression check, roles validation live in `packages/domain` as pure code with unit tests; static boundary rule keeps them free of provider/AI imports. | Pass |
| X | Structured AI outputs | An optional AI fit suggestion has a Zod schema in `packages/ai-contracts` (`IcpFitSuggestion`) and is stored apart from the rule result. Nothing generates it in this feature. | Pass |
| XI | Untrusted input | CSV content is treated as data: values are never interpreted, only validated and stored; formula-leading cells are neutralised on export (R-05). | Pass |
| XII | Explainable | Assessment lists met/unmet criteria, evidence, confidence, definition version. | Pass |
| XIII | Capacity | n/a | n/a |
| XIV | Privacy / minimisation | Contact field allow-list (name, title, department, business email, profile URL); no personal email; erasure keeps only a keyed hash of the email as suppression marker (R-09). | Pass |
| XV | Provider independence | No providers needed; evidence/AI hooks remain behind existing interfaces. | Pass |
| XVI | Modular monolith | New code only in `accounts`, `contacts`, `icp` modules (public index + events). Cross-module reads go through exported functions. | Pass |
| XVII | Test before autonomous action | Test-first for evaluator, similarity, CSV parser, suppression, role validation. Scenario F (suppression) fixture `pat.unsubscribed@example.org` exercised here. | Pass |
| XVIII | Hypotheses labelled | ICP definitions, size band, thresholds, source/basis lists, file limits, permission matrix are stored/documented with `status: hypothesis` and a visible label in the UI. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotency, correlation IDs, redacted logs | Same mechanisms as 001. | Pass |
| Security baseline | RBAC, audit on every change, encryption | New permissions (R-08); audit in-transaction incl. refusals; encryption per 001 baseline. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` | Domain additions covered by table-driven tests; coverage threshold unchanged. | Pass |

**Gate result (pre-research)**: PASS. No violations; Complexity Tracking is empty.

**Post-design re-check**: PASS. Two spec points are interpreted and flagged for confirmation: erasure hash is a keyed HMAC (spec says "one-way hash"; keyed is stronger because emails are guessable — R-09), and "valid rows saved even when others fail" is implemented as per-row transactions inside one import run (R-03). The runbook's `communication_preference` table is deliberately not built (R-12).

## Project Structure

### Documentation (this feature)

```text
specs/002-accounts-contacts-icp/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: tables, constraints, state transitions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── accounts.openapi.yaml
│   ├── contacts.openapi.yaml
│   ├── icp.openapi.yaml
│   ├── suppressions.openapi.yaml
│   └── review.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/domain/src/
├── icp/                      # pure: definition schema, evaluator, status/confidence, eligibility
│   ├── definition.ts         # Zod schema + validation of an ICP rule set (FR-039)
│   ├── evaluate.ts           # evaluate(account, evidence, definition) -> assessment (FR-019..FR-024)
│   ├── eligibility.ts        # priorityEligible(fit, activeOverride) (FR-030)
│   └── defaults.ts           # initial ICP 1 / ICP 2 definitions, status: hypothesis
├── accounts/
│   ├── normalise.ts          # domain, name, alias normalisation
│   ├── similarity.ts         # trigram similarity (replaces pg_trgm), FR-004
│   ├── resolve.ts            # candidate detection rules incl. shared-domain + type/geo gate
│   └── org-types.ts          # fixed organisation type list (FR-010), excluded set (FR-027)
├── contacts/
│   ├── validate-contact.ts   # source/basis/personal-domain/email rules (FR-012..FR-015)
│   ├── roles.ts              # 20 stakeholder roles, confirm-economic-buyer rule (FR-032..FR-034)
│   └── suppression.ts        # isSuppressed(...) + email keyed hash (FR-041..FR-045, FR-049)
├── csv/
│   └── parse.ts              # RFC 4180 parser, size/row limits, header validation
└── (rbac/permissions.ts gains feature-002 permissions and role mapping)

packages/ai-contracts/src/icp-fit-suggestion.ts   # optional labelled AI suggestion schema
packages/db/
├── migrations-sqlite/0007_accounts.sql  0008_contacts.sql  0009_icp.sql  0010_suppression_review.sql
└── src/classification.ts                # + all new tables/columns
apps/api/src/modules/
├── accounts/   {service,import,merge,routes,events,index}.ts
├── contacts/   {service,import,relationships,erasure,routes,eligibility,index}.ts
└── icp/        {definitions,assessments,overrides,routes,index}.ts
apps/api/src/worker/ (register queues accounts.import, contacts.import)
apps/web/src/app/(operator)/{accounts,accounts/[id],contacts,review}/page.tsx
apps/web/src/lib/{accounts-api,contacts-api,icp-api,review-api}.ts
tests/fixtures/synthetic-orgs/       # 10 fixtures + CSV files (first task)
tests/{unit,integration,contracts}/  # per module, plus e2e fixtures import test
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as Feature 001. The existing empty `accounts` and `icp` module stubs are filled in and `contacts` is added; no new deployable, package or service.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
