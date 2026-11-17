# Research: Project Foundation

Each entry: Decision, Rationale, Alternatives considered. Stack choices come from the project owner's recommended stack in the `/speckit-plan` input. Where the spec left a detail open, the decision here is a plan-level default and is flagged **[Assumption]** for confirmation in `/speckit-clarify`. All numeric values are hypotheses until measured.

## R-01 Language, runtime, workspace
- **Decision**: TypeScript in strict mode on Node.js 22 LTS; pnpm workspaces.
- **Rationale**: One language across API, worker, web and shared Zod schemas; the constitution mandates strict TypeScript. pnpm gives strict dependency isolation, which supports module-boundary enforcement.
- **Alternatives**: npm or yarn workspaces (weaker isolation); Python or Go backend (loses shared schemas with the web app).

## R-02 Topology
- **Decision**: Modular monolith. `apps/api` runs HTTP and worker roles from one codebase and one image; `apps/web` is a separate Next.js app; shared code in `packages/{domain,ai-contracts,providers,db}`. Module boundaries enforced with eslint-plugin-boundaries (public `index.ts` plus domain events only).
- **Rationale**: Constitution XVI; small team; transactional consistency between state, audit and outbox.
- **Alternatives**: Microservices (rejected; operational cost, needs an ADR to split); single Next.js full-stack app (rejected; worker role and API contract separation are harder).

## R-03 API framework and contract generation
- **Decision**: Fastify with Zod-based validation; OpenAPI 3.1 generated from Zod via zod-to-openapi; contracts in `contracts/` are the reviewed source and CI checks the generated spec has no drift.
- **Rationale**: Single schema source for validation and documentation; light-my-request testing is built in.
- **Alternatives**: NestJS (heavier, decorators); tRPC (less suitable for webhook ingress and external contracts); Express (less structured validation).

## R-04 Database and migrations
- **Decision**: PostgreSQL 16; Drizzle ORM; drizzle-kit forward-only migrations; UUIDv7 primary keys; `created_at` and `updated_at` on every mutable table; soft-delete only where retention requires it.
- **Rationale**: Postgres carries relational data, the job queue and the outbox with one backup and one transaction boundary. UUIDv7 is time-ordered, which helps index locality. Forward-only migrations satisfy the constitution; rollback is by a new forward migration.
- **Alternatives**: Prisma (heavier runtime, weaker raw-SQL control for partitioning and triggers); separate document store (extra infra, no transactional audit).

## R-05 Jobs
- **Decision**: pg-boss for execution (retry, backoff, cron, singleton keys). An application-owned `job` table is the source of truth for visibility and audit: every state transition (queued, running, succeeded, failed) writes to `job` and an audit event. Idempotency is a unique `(queue, idempotency_key)` constraint on `job`, also passed to pg-boss as the singleton key.
- **Rationale**: No extra infrastructure; administrators need a stable, queryable, redacted view that does not depend on pg-boss internals. Cron uniqueness across instances is provided by pg-boss scheduling.
- **Alternatives**: BullMQ plus Redis (rejected for MVP; extra infrastructure); read pg-boss tables directly (couples the UI and audit to library internals).
- **Concurrency**: per-queue worker concurrency limit and a queue-depth cap with back-pressure (new submissions rejected with a typed error rather than dropped silently). **[Assumption]** values in R-14.

## R-06 Events and outbox
- **Decision**: Transactional outbox table written in the same transaction as the state change and the audit event; an in-process dispatcher publishes to module subscribers. Envelope: `{event_id, type, schema_version, occurred_at, actor, correlation_id, causation_id, idempotency_key, payload, provenance}`.
- **Rationale**: Modules talk only through events, so the outbox is both the integration mechanism and the audit-adjacent record.
- **Alternatives**: Direct in-process pub/sub (loses events on crash); message broker (extra infrastructure).

## R-07 Authentication and sessions
- **Decision**: OIDC, provider configurable (Google Workspace or Microsoft Entra). Auth.js in `apps/web` runs the sign-in flow. `apps/web` calls the API with the user's ID token; the API verifies signature, issuer, audience and expiry against the provider's JWKS, then looks up the user and roles in the database on **every request**. No roles or permissions are read from the token. Sign-in is allowed only for users with an `active` or `invited` record. Sessions: 8-hour absolute lifetime, 30-minute idle timeout **[Assumption]**. A fake OIDC issuer (local JWKS) is used in tests and local development until open question #8 is decided.
- **Rationale**: Reading roles from the database each request makes role changes and deactivation effective by the next request (spec US1 scenario 5) with no token revocation machinery. During an IdP outage, existing sessions keep working until expiry while new sign-ins fail (spec edge case).
- **Alternatives**: Email magic link (rejected: adds email delivery dependency and a local credential path, contradicts FR-002); roles in token claims (stale permissions); API-issued sessions (more code, no benefit at this scale).
- **Bootstrap administrator**: the first administrator is created by an explicit CLI command (`pnpm admin:bootstrap --email …`) run by an operator with database access, which writes an audit event. It refuses to run if an administrator already exists. **[Assumption]** resolves checklist CHK010.

## R-08 Authorisation model
- **Decision**: Tables `user`, `role`, `permission`, `user_role`, `role_permission`. Effective permissions are the union over the user's roles; deny by default; no deny rules. Foundation permissions: `users.manage`, `audit.read`, `jobs.read`, `webhooks.read`, `quarantine.review`, `ai_invocations.read`, `providers.manage`. The administrator role holds all. Other roles hold none of these in this feature (later features add their own). Quarantine review is limited to the administrator role **[Assumption]**, matching the spec's assumption; later a dedicated permission can be granted to another role without code change. Actor types (`human`, `ai`, `system`) are recorded; a rule in `packages/domain/rbac` denies `users.manage`, any approval permission and `quarantine.review` to non-human actors (FR-009). The last-administrator rule is enforced in a transaction with a row lock on the administrator role membership.
- **Rationale**: Simple, testable, matches FR-004 to FR-009.
- **Alternatives**: ABAC or policy engine (over-engineered); roles hard-coded in code (no runtime assignment).

## R-09 Webhook ingress ordering and verification
- **Decision**: Order of operations for `POST /webhooks/{source}`:
  1. Enforce body size limit while streaming (default 1 MiB); over limit returns 413 and nothing is persisted.
  2. Validate the timestamp header against the allowed skew window (default ±5 minutes) and verify the HMAC signature over the raw bytes using the source's secret (secrets by reference from config).
  3. Run the PHI guard over the in-memory body, headers and query string.
  4. If blocked: persist a **metadata-only** `webhook_event` row (status `blocked_phi`, no body, no headers), write an audit event, notify operators, return 422.
  5. Otherwise persist the raw body and headers with `verification_status` (`verified`, `failed`, `not_verifiable`), then enqueue processing only if `verified` (or the source is configured `not_verifiable` and explicitly flagged).
  6. Duplicate `(source, delivery_id)` is detected by a unique constraint and recorded as a duplicate; it is acknowledged with 200 and not reprocessed.
  A failed signature or skew check does NOT short-circuit steps 3–5: the PHI guard still runs on every delivery before anything is persisted (spec FR-029), because unverified bodies are attacker-controlled. Failed-verification deliveries are then stored (without being processed) so they can be investigated; a replay of a delivery ID whose first attempt failed verification is recorded as a new attempt on the same row and still not processed unless it verifies.
- **Rationale**: Reconciles FR-029 (stored before processing) with FR-032 and Principle IV (PHI is never retained in clear). "Raw-first" is interpreted as "persisted before any processing", not "persisted before inspection". **[Assumption]** this resolves checklist CHK025 and needs confirming; if not accepted, the spec text must change.
- **Alternatives**: Persist raw before guard (stores PHI-bearing content; rejected); guard after enqueue (processing precedes inspection; rejected).

## R-10 PHI guard and classification
- **Decision**: `packages/domain/privacy` exports (a) the `DataClassification` enum (public, business_contact, confidential_commercial, internal_case_study_restricted, sensitive_operational_metadata, prohibited), (b) a deterministic, versioned detector pipeline (regex rules plus structural heuristics) returning a `GuardDecision {decision: allow|reject|quarantine, rule_ids[], guard_version}` and never the matched content, and (c) integration points: API body and upload middleware, webhook ingress, a pino serializer filter, the audit-summary writer, the provider-call wrapper and the LLM-gateway pre-flight check. Initial detectors: SSN, MRN adjacent to a person-name token, DOB adjacent to a person-name token, tabular rows with multiple patient-style columns, and credential patterns (API keys, private-key headers, bearer tokens) so FR-016's "credentials" are covered **[Assumption]** resolves CHK048. Unclassifiable content defaults to reject (FR-022). Default action is **reject**; **quarantine** applies to uploads and webhook sources explicitly configured for review **[Assumption]**. The UI is covered by the same API-side guard on every submission plus a client-side warning that is advisory only (server is authoritative) **[Assumption]** resolves CHK038. Guard output and provider responses stored by the platform pass through the guard before persistence.
- **Rationale**: Principles IV and IX: deterministic, no LLM, unit-tested, versioned. Rule IDs, not content, are recorded.
- **Alternatives**: LLM-based PHI detection (rejected; nondeterministic, would itself send suspected PHI to a model); third-party DLP service (provider dependency and data egress); regex only (misses structural patterns).
- **Quarantine**: a `quarantine_item` row holds encrypted content with an access log and disposition (`released`, `discarded`); content is purged after a maximum holding period of 30 days **[Assumption]**.

## R-11 Audit and retention
- **Decision**: `audit_event` is append-only. The application role has INSERT and SELECT only; a trigger rejects UPDATE and DELETE; each row stores `prev_hash` and `row_hash` (hash chain) so after-the-fact edits by a database administrator are detectable **[Assumption]** (tamper evidence, CHK017). Audit and the state change commit in one transaction (FR-013). The table is partitioned monthly; retention (default 7 years per open question #17) is implemented by dropping whole partitions through a privileged, separately audited maintenance command, which reconciles append-only (no row updates or deletes) with retention **[Assumption]** (CHK016, CHK050). Audit events are readable with `audit.read`.
- **Alternatives**: Separate audit store (loses transactional guarantee); no hash chain (no tamper evidence); row-level delete for retention (violates append-only).

## R-12 Logging, redaction, correlation
- **Decision**: pino JSON logs with a redaction path list (authorization headers, cookies, tokens, secrets, passwords, signatures) plus a serializer that runs the PHI guard over message fields and error objects, replacing matches with `[REDACTED:<rule_id>]`. A correlation-ID middleware accepts an inbound `X-Correlation-ID` only if it matches `^[A-Za-z0-9._-]{8,64}$`, otherwise generates a UUIDv7; the ID is carried via AsyncLocalStorage into logs, audit events, outbox events, jobs and provider calls. OpenTelemetry traces and metrics use the same ID as an attribute. The test suite seeds a canary secret and a canary PHI-like string and a Vitest global check scans captured log output (FR-035, SC-006).
- **Alternatives**: Winston (slower, weaker redaction ergonomics); logging raw then scrubbing in a pipeline (leak window).

## R-13 Providers and AI invocation
- **Decision**: `packages/providers` defines eight interfaces (ResearchSourceProvider, PublicDataProvider, ContactEnrichmentProvider, LLMProvider, EmailProvider, CalendarProvider, CRMProvider, FileStorageProvider), each with a fake and a shared contract-test suite run against every implementation. Every call goes through a wrapper that applies the PHI guard to outbound payloads, maps failures to a typed result (`ok | error{code, retryable}`), records correlation ID, and writes a provider-call log. A CI check fails on any real network use during tests. The LLM gateway (in `apps/api/src/modules/providers`) runs PHI pre-flight, calls `LLMProvider`, validates the response against a Zod schema from `packages/ai-contracts`, and writes an `ai_invocation` row (model, prompt version, schema version, token counts, cost estimate from configured rates, latency, validation result, refusal flag) without storing prompt or response content. Prompt content is referenced by `prompt_version`, not copied per call.
- **Alternatives**: Direct vendor SDK use in modules (violates XV); storing prompts/responses for debugging (risks prohibited content; rejected).

## R-14 Numeric defaults (hypotheses, all configurable)
| Parameter | Default | Status |
|---|---|---|
| Job retries | 5 attempts, exponential backoff 30 s base, factor 2, jitter, cap 1 h | hypothesis |
| Worker concurrency per queue | 5 | hypothesis |
| Queue depth cap before back-pressure | 1,000 | hypothesis |
| Webhook timestamp skew window | ±5 min | hypothesis |
| Webhook body limit | 1 MiB | hypothesis |
| API JSON body limit | 2 MiB | hypothesis |
| Upload limit | 10 MiB | hypothesis |
| Session absolute / idle | 8 h / 30 min | hypothesis |
| Invitation expiry | 7 days | hypothesis |
| Quarantine max holding | 30 days | hypothesis |
| Audit retention | 7 years | open question #17 default |
| AI invocation record retention | 12 months | open question #17 default |
| Health/readiness target | < 1 s | spec SC-009 |

## R-15 Observability endpoints
- **Decision**: `GET /health/live` (process alive, no dependency checks) and `GET /health/ready` (database reachable, migrations at expected version, job queue reachable, configured IdP JWKS fetch fresh within a grace period) are unauthenticated and return only status and generic check names, no hostnames, versions of internals, secrets or user data.
- **Alternatives**: Single endpoint (conflates liveness and readiness, causes restarts on dependency outage).

## R-16 Secrets and configuration
- **Decision**: A typed config module (Zod) loads environment variables at start-up and fails fast on missing or malformed values. `.env.example` contains placeholders only. A secret scanner (gitleaks) runs in CI and as a pre-commit hook. Production uses the platform secret manager (provider-agnostic). Webhook signing secrets and provider credentials are referenced by name in `provider_connection` / `webhook_source` records; the value is never stored in the database or shown in the UI **[Assumption]** (CHK020–022). Rotation: a source may hold a current and a previous secret during an overlap window.
- **Alternatives**: Secrets in database (extra attack surface); committed encrypted files (key management burden).

## R-17 Testing and CI
- **Decision**: Vitest for unit tests (coverage threshold 80% on `packages/domain` and `packages/ai-contracts`, enforced); Testcontainers PostgreSQL for integration and migration tests (including a test that applies all migrations to an empty database and a test that the audit table rejects UPDATE and DELETE); light-my-request for API contract tests; shared adapter contract tests; Playwright arrives with feature 006. GitHub Actions jobs: install, lint, typecheck, unit, integration, build, `pnpm audit`, secret scan, OpenAPI drift check. Dependabot enabled.
- **Alternatives**: Jest (slower with ESM and TS); in-memory fake DB (hides Postgres behaviour such as triggers and partitions).

## R-18 Local development and deployment
- **Decision**: `docker compose` provides Postgres and Mailpit; `pnpm dev` starts API (both roles) and web with the fake OIDC issuer and all fake providers; `pnpm db:migrate`, `pnpm db:seed:synthetic`. One container image for api/worker and one for web, built and documented in quickstart.md; no cloud automation in this feature (open question #16).
- **Alternatives**: Kubernetes manifests now (out of scope).

## R-19 Encryption
- **Decision**: Spec FR-051 and SC-012 require encrypted connections and encryption at rest. TLS is terminated at the platform edge and used between web, API and database; in production the typed config module (R-16) refuses to start when the database URL does not require TLS (`sslmode=verify-full` or `require`) or when the OIDC issuer or web-to-API base URLs are not `https`. Database and object-storage encryption at rest are deployment requirements documented in quickstart.md and the container-build runbook, with a verification checklist. Quarantine content is additionally encrypted at the application layer with a key supplied through configuration (never stored in the database).
- **Alternatives**: Rely on deployment documentation only (rejected: nothing would enforce or test it); application-layer encryption of all columns (over-engineered for this feature).

## Open items carried to clarification
IdP choice (#8); retention values (#17, #24); quarantine reviewer role; UI coverage of the PHI guard (R-10). Resolved in spec on 2026-11-12: reject-by-default (clarify Q1), webhook ordering (FR-029), audit retention mechanism (FR-012, FR-053), encryption (FR-051).
