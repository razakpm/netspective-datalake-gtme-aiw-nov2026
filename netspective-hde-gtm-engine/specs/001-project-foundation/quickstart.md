# Quickstart: Project Foundation

A run-and-validate guide. It contains no implementation code. Details live in [contracts/](contracts/) and [data-model.md](data-model.md). All data is synthetic; no real credentials are used.

## Prerequisites

- Node.js 22 LTS, pnpm, Docker with Compose.
- A clean checkout of branch `001-project-foundation`.
- Copy `.env.example` to `.env` (placeholders only; the file is git-ignored).

## 1. Start locally (one command)

```text
pnpm dev
```

Expected: Postgres and Mailpit start via Compose; migrations apply; synthetic seed data loads; the API (HTTP and worker roles) and web app start with the fake OIDC issuer and fake providers. Target: under 15 minutes from checkout excluding downloads (SC-007, hypothesis).

Supporting commands: `pnpm db:migrate`, `pnpm db:seed:synthetic`, `pnpm admin:bootstrap --email admin@example.org` (creates the first administrator; refuses if one exists).

## 2. Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|---|---|---|---|
| V1 | Non-administrator cannot manage users | Sign in as a seeded user holding only `gtm_operator`; `POST /api/v1/users` | 403; one `denied` audit event | FR-005, SC-001 |
| V2 | Invite and assign roles | Sign in as the seeded administrator; invite a user with two roles | 201; user `invited`; one audit event; invitee given `gtm_operator` and `read_only_executive` holds exactly jobs.read, webhooks.read, audit.read and ai_invocations.read, and cannot manage users | FR-001, FR-004 |
| V3 | User with zero roles | Sign in as seeded user with no roles | Authenticated, no areas shown, "no access assigned" message | FR-008 |
| V4 | Last administrator protected | Try to remove the administrator role from the only administrator | 409; no change; denied audit event | FR-007 |
| V5 | Webhook replay | Send the same signed delivery ID twice (test helper script) | Second returns 200 `duplicate: true`; one processing job | FR-030, SC-003 |
| V6 | Bad signature and skew | Send a delivery with a wrong signature, then one with a timestamp 10 minutes old | 401 stored as `failed`; 408 stored as `rejected_stale`; neither processed | FR-029, FR-031 |
| V7 | Failing job | Enqueue the synthetic always-failing job | Retried per policy then `failed`; visible to administrator with redacted error; audit events for each transition | FR-025, FR-026, SC-004 |
| V8 | Duplicate job key | Enqueue the same key twice | One execution | FR-024 |
| V9 | PHI blocked at API | Submit each synthetic sample from `tests/fixtures` (SSN, MRN with name, DOB with name, tabular rows) | 422 for each; audit event without content; nothing stored; nothing logged | FR-017, SC-005 |
| V10 | PHI never reaches an LLM | Call the LLM gateway with a flagged sample using the fake `LLMProvider` | Refused before the provider; `ai_invocation` row with `refused_phi`; no content stored | FR-043 |
| V11 | Log canaries | Run the test suite; the global log scan runs afterwards | Zero occurrences of seeded secret or PHI-like canary | FR-035, SC-006 |
| V12 | Health and readiness | `GET /health/live`, `GET /health/ready`; stop Postgres and repeat | 200 live without sign-in; ready returns 503 naming `database` when it is down | FR-044, SC-009 |
| V13 | Provider contract | `pnpm test:contracts` | All eight fakes pass the shared contract suite; no real network calls | FR-037, SC-010 |
| V14 | Audit immutability | Integration test attempts UPDATE and DELETE on `audit_event` | Both rejected | FR-012 |

## 3. Tests and checks (also run in CI)

```text
pnpm lint
pnpm typecheck
pnpm test            # unit, with coverage thresholds (80% on packages/domain and packages/ai-contracts)
pnpm test:integration   # Testcontainers Postgres, migrations from empty
pnpm test:contracts
pnpm build
pnpm audit
```

CI (GitHub Actions) runs: install, lint, typecheck, unit, integration, contracts, build, dependency audit, secret scan, OpenAPI drift check. A failure blocks merge (FR-046).

## 4. Container build

```text
docker build -f docker/Dockerfile.api -t gtm-engine-api .
docker build -f docker/Dockerfile.web -t gtm-engine-web .
```

Run both images with environment variables supplied by the platform secret manager; the api image starts HTTP and worker roles. Verify with the health and readiness endpoints. Cloud target is deferred (open question #16).

## 5. Deployment requirements (documented, not automated here)

- TLS terminated at the platform edge; web-to-API traffic encrypted.
- Database and object-storage encryption at rest enabled.
- Production refuses fake providers and the fake OIDC issuer at start-up.
- Real prospect data exists only in deployed environments.
