# Implementation Plan: Project Foundation

**Branch**: `001-project-foundation` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-project-foundation/spec.md`

## Summary

Deliver a secure, observable, testable skeleton for the GTM Engine: company-OIDC sign-in with database-backed RBAC, an append-only audit trail, a deterministic PHI-boundary guard with a data-classification framework, idempotent background jobs, raw-first idempotent webhook ingress, correlation-aware redacted logging, provider adapter interfaces with fakes, an AI-invocation ledger behind an LLM gateway with PHI pre-flight, health/readiness endpoints, one-command local run, and CI. No GTM business logic.

Technical approach (details and alternatives in [research.md](research.md)): a TypeScript modular monolith (one API codebase running HTTP and worker roles, plus an internal Next.js web app) on PostgreSQL 16 as the single system of record. Postgres also carries the job queue (pg-boss) and the transactional event outbox, so no extra infrastructure is needed. Authorisation is read from the database on every request. The PHI guard and all policy rules are plain, versioned, unit-tested code in `packages/domain`.

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces

**Primary Dependencies**: Fastify (REST) with zod-to-openapi (OpenAPI 3.1 from Zod); Zod for all validation; Drizzle ORM + drizzle-kit; pg-boss; pino; OpenTelemetry; Auth.js (web) with JWT/JWKS verification (api); Next.js App Router (web); eslint-plugin-boundaries

**Storage**: PostgreSQL 16 (system of record, job queue, outbox); FileStorageProvider (local-disk fake, S3-compatible adapter) for non-PHI artifacts only

**Testing**: Vitest (unit); Testcontainers PostgreSQL (integration and migration); light-my-request/supertest (API contract); shared adapter contract tests; Playwright deferred to feature 006

**Target Platform**: Linux containers (one image for api/worker, one for web); local dev via docker compose

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, shared `packages/*`)

**Performance Goals**: Health and readiness respond in under 1 second under normal conditions (SC-009); authorisation check adds one indexed lookup per request. No throughput target in this feature (internal tool, small user count; hypothesis, to be measured).

**Constraints**: No PHI, patient data or credentials in storage, logs, prompts or fixtures; no real external calls in tests; forward-only migrations; audit write is in the same transaction as the state change; secrets from environment only

**Scale/Scope**: Tens of internal users; job and webhook volumes low but bursty (job-storm and replay handling required); 8 provider interfaces; ~16 tables

Numeric defaults (retry policy, skew window, size limits, concurrency, session and invitation lifetimes) are listed in research.md R-14 and are configurable hypotheses.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design (see end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | No conclusions in this feature. The event envelope carries `provenance`; `ai_invocation` is the ledger later features reference. | Pass (n/a for content) |
| II | Buyer-confirmed vs assumption | No facts stored. Actor type (`human`/`ai`/`system`) is recorded on every audit event so later features can forbid AI-originated confirmation. | Pass |
| III | Provenance | Envelope `provenance` field; `webhook_event` records source, received time and raw hash; `ai_invocation` records model, prompt and schema versions. | Pass |
| IV | Non-PHI by default | PHI guard (`packages/domain/privacy`) applied at API body, upload, webhook, provider-call, LLM-gateway, log-serializer and audit-summary points; quarantine path with restricted access. | Pass |
| V | No unsupported claims | No outward content in this feature. | n/a |
| VI | ICP focus | No ICP logic. Module stubs for later features only. | n/a |
| VII | Buyer value over volume | Not applicable to the skeleton. | n/a |
| VIII | Human approval | RBAC assigns `campaign approver`; actor-type check blocks AI/system actors from approval and user-management permissions (FR-009). Approval workflow itself arrives in later features. | Pass |
| IX | Deterministic rules | PHI guard, RBAC checks, idempotency and retry policy are plain code in `packages/domain`; lint rule forbids importing `packages/providers` or `ai-contracts` into rule modules. | Pass |
| X | Structured AI outputs | LLM gateway validates output against a Zod schema; failures recorded `invalid`; no reasoning traces stored. Schemas live in `packages/ai-contracts`. | Pass |
| XI | Untrusted input | Gateway marks all external content as data in a delimited block, restricts tools to an empty allow-list by default (spec FR-052); prompt-injection fixtures and tests are built here (tasks T101, T104), and feature 004 extends them for real research content. | Pass |
| XII | Explainable recommendations | Not applicable. | n/a |
| XIII | Delivery capacity | Not applicable. | n/a |
| XIV | Privacy and minimisation | `user` stores only email, display name, status; contact data arrives in feature 002. | Pass |
| XV | Provider independence | Eight interfaces in `packages/providers` with fakes and shared contract tests; boundary lint forbids vendor SDK imports outside adapters. | Pass |
| XVI | Modular monolith first | One API codebase with HTTP and worker roles from the same image, plus web UI; `eslint-plugin-boundaries` enforces module access via public index and domain events. | Pass |
| XVII | Test before autonomous action | Test-first tasks for every rule; scenarios A–G are later features, but the Scenario D (PHI) fixture is built here. | Pass |
| XVIII | Hypotheses labelled | Numeric defaults recorded as hypotheses with `status: hypothesis` in configuration documentation. | Pass |
| Eng. standards | Strict TS, lint/format CI, forward-only migrations, idempotency keys, correlation IDs, redacted logs, no secrets in repo | All in plan | Pass |
| Security baseline | RBAC with seven roles, least privilege, audit every state change, encryption in transit and at rest | Roles seeded; encrypted connections and at-rest encryption required by spec FR-051 and enforced by a production start-up check (tasks T014–T015), with a deployment verification checklist | Pass |
| Quality gates | clarify, analyze (no CRITICAL), converge before merge; 80% coverage on `packages/domain` and `packages/ai-contracts` | CI coverage thresholds | Pass |

**Gate result (pre-research)**: PASS. No unjustified violations, so the Complexity Tracking table is empty.

**Post-design re-check**: PASS. Design added two points that interpret the spec and must be confirmed in `/speckit-clarify`: webhook ordering (guard runs on the in-memory body before the raw row is persisted, so "raw-first" means "persisted before processing", see research R-09) and audit retention by partition drop (see R-11). Neither conflicts with the constitution.

## Project Structure

### Documentation (this feature)

```text
specs/001-project-foundation/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: tables, constraints, state transitions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── auth.openapi.yaml
│   ├── users.openapi.yaml
│   ├── health.openapi.yaml
│   └── webhooks.openapi.yaml
├── checklists/
└── tasks.md             # Phase 2 (/speckit-tasks, not created here)
```

Also produced outside the feature folder: `docs/architecture/overview.md` (Mermaid component diagram) and `docs/adr/ADR-001, 002, 004, 006, 013, 014` (the Feature 001 rows of the runbook's ADR table).

### Source Code (repository root)

```text
apps/
├── api/                           # Fastify; HTTP and worker roles from one codebase
│   ├── src/
│   │   ├── main.ts                # role switch: http | worker | both
│   │   ├── config/                # typed config module (Zod), no secrets in repo
│   │   ├── http/                  # server, correlation-id, auth, guard, error mapping
│   │   ├── worker/                # pg-boss bootstrap, handlers registry
│   │   └── modules/               # enforced boundaries (public index + events only)
│   │       ├── identity/          # users, roles, invitations, sessions-lookup   (built here)
│   │       ├── audit/             # audit writer + reader                         (built here)
│   │       ├── jobs/              # job service + admin visibility                (built here)
│   │       ├── providers/         # provider registry, connection records         (built here)
│   │       └── <accounts, contacts, icp, signals, research, hypotheses, capabilities,
│   │            offers, workshops, qualification, content, campaigns, engagement,
│   │            intent, opportunities, analytics>/   # empty stubs with index.ts only
│   └── test/                      # contract + integration
└── web/                           # Next.js App Router, Auth.js, server-side session
    ├── src/app/                   # sign-in, no-access, admin/users, admin/jobs, quarantine
    └── test/

packages/
├── domain/                        # entities, Zod schemas, pure rules
│   └── src/{privacy, rbac, jobs-policy, webhook, audit, events, logging}/
├── ai-contracts/                  # structured-output schema registry, prompt version ids
├── providers/                     # 8 interfaces, fakes, contract-test suite, adapters (S3, local)
└── db/                            # Drizzle schema, forward-only migrations, synthetic seed

tests/
├── fixtures/synthetic-orgs/       # existing
└── e2e/                           # Playwright from feature 006

docs/{adr, architecture}/
docker/                            # Dockerfile.api, Dockerfile.web, compose.yaml
.github/workflows/ci.yml
```

**Structure Decision**: Web-application layout as a pnpm workspace matching the runbook's repository layout and constitution Principle XVI. Later feature modules exist only as empty folders with a public `index.ts`, so the boundary lint rules are exercised from day one without adding behaviour.

## Complexity Tracking

No constitution violations to justify.
