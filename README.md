# Netspective Healthcare Data Engineering GTM Engine

An internal, service-specific go-to-market (GTM) intelligence and orchestration system for Netspective's
Healthcare Data Engineering / Data Lake service. It connects the chain from organisation to outcome:

> organisation → evidence → problem hypothesis → ICP fit → stakeholder → service capability → offer →
> engagement → qualification → paid scope → outcome learning

It is **not** a customer-facing product, an EHR, a patient-data repository, a generic CRM, a bulk email
sender or an autonomous SDR. See [guardrails](netspective-hde-gtm-engine/docs/context/01-guardrails.md).

> **Synthetic data only.** This repository must never contain PHI, real patient data, real credentials or
> real prospect data, in code, tests, fixtures, logs or prompts.

## Status

The project is built feature by feature with [GitHub Spec Kit](https://github.com/github/spec-kit)
(specify → clarify → plan → tasks → analyze → implement). Specs live in
[`netspective-hde-gtm-engine/specs/`](netspective-hde-gtm-engine/specs).

| #   | Feature                                                                                                  | State                                |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 001 | [Project foundation](netspective-hde-gtm-engine/specs/001-project-foundation)                            | Partly built; provider work ongoing  |
| 002 | [Accounts, contacts and ICP](netspective-hde-gtm-engine/specs/002-accounts-contacts-icp)                 | Merged; some tasks open              |
| 003 | [Signals and evidence](netspective-hde-gtm-engine/specs/003-signals-evidence)                            | Merged                               |
| 004 | [Account research and hypotheses](netspective-hde-gtm-engine/specs/004-account-research-hypotheses)      | Implemented, in review (PR #10)      |
| 005 | [Capabilities, offers and claims](netspective-hde-gtm-engine/specs/005-capabilities-offers-claims) | Implemented, in review (PR #12) |
| 006–013 | Routing, workshops, qualification, content, engagement, intent, analytics, dashboard | Planned ([feature map](netspective-hde-gtm-engine/docs/context/03-feature-map.md)) |

### What feature 004 provides

- **Bounded research runs** over approved sources only, with source and cost budgets, one active run per
  account, and incremental re-runs (unchanged pages are not re-processed).
- **Untrusted-content handling.** Page text is data, never instructions: delimited data blocks, an empty tool
  allow-list, a deterministic prompt-injection scanner and a PHI guard. Embedded instructions raise a flag and
  change nothing ([ADR-018](netspective-hde-gtm-engine/docs/adr/ADR-018-research-gateway-and-untrusted-content.md)).
- **Verified output.** Code checks every finding (cited source, quote present, protected topics as unknowns) and
  assembles the summary, separating facts, inferences, unknowns and contradictions.
- **Hand-off to signals.** Findings enter feature 003 as pending, reviewable signals.
- **Hypotheses.** Proposals, analyst-created hypotheses, reviewer-only status changes with a note, and
  `validated` only with approved buyer-confirmed evidence.
- **Cost caps** per run and per account per month, in integer micro-units.
- **Target Account Workspace v1** at `/accounts/[id]/workspace`.

## Repository layout

```text
.
├── .github/workflows/ci.yml          CI: lint, format, typecheck, unit, integration, contract tests
└── netspective-hde-gtm-engine/       The application (pnpm workspace)
    ├── apps/
    │   ├── api/                      Fastify 5 API, worker and modules (research, hypotheses, signals, ...)
    │   └── web/                      Next.js operator UI
    ├── packages/
    │   ├── domain/                   Pure business rules (no I/O), unit tested
    │   ├── ai-contracts/             Zod schemas, JSON Schema export, prompts and fixtures for AI output
    │   ├── providers/                Provider interfaces, fakes, adapters, wrapper
    │   └── db/                       Migrations, seeds and the persistence layer
    ├── docs/                         Context, guardrails, ADRs, architecture, runbooks
    ├── specs/                        One folder per Spec Kit feature
    ├── tests/fixtures/               Synthetic fixtures (pages, fake model scenarios)
    └── docker/                       Local infrastructure and Dockerfiles
```

The API is a modular monolith ([ADR-001](netspective-hde-gtm-engine/docs/adr/ADR-001-modular-monolith.md)).
Persistence is currently an interim SQLite store behind a transaction interface
([ADR-015](netspective-hde-gtm-engine/docs/adr/ADR-015-interim-sqlite-persistence.md)); PostgreSQL remains the
target system of record ([ADR-002](netspective-hde-gtm-engine/docs/adr/ADR-002-postgresql-system-of-record.md)).

## Design principles

- **Deterministic rules are plain code.** Eligibility, suppression, permissions, capacity, PHI checks and SQL
  rules are unit-tested functions, never model calls.
- **Every AI output is schema-validated** against a Zod schema in `packages/ai-contracts`. No hidden
  chain-of-thought is stored, only a short rationale and evidence references.
- **No PHI.** The system works on non-PHI data only ([ADR-004](netspective-hde-gtm-engine/docs/adr/ADR-004-non-phi-data-boundary.md)).
- **No unapproved claims.** Outcome metrics, compliance statements and case-study figures need an approved
  claim record.
- **Human review.** AI output enters as pending; people approve, reject and change status.

## Getting started

Requirements: Node.js 22 or later and pnpm 10 (the repository pins `pnpm@10.19.0`).

```bash
cd netspective-hde-gtm-engine
pnpm install
cp .env.example .env        # placeholders only; set values locally, never commit them
```

Run the checks:

```bash
pnpm lint
pnpm format                 # prettier --check
pnpm typecheck
pnpm test                   # unit tests with coverage
pnpm test:integration
pnpm test:contracts
```

CI runs the same checks on every pull request.

> The root `dev`, `db:migrate` and `db:seed:synthetic` scripts are placeholders that exit with a message until
> their tasks land (see [feature 001 tasks](netspective-hde-gtm-engine/specs/001-project-foundation/tasks.md)).
> The API entry point is `apps/api/src/main.ts` (`--role http|worker|both`); the database file defaults to
> `./.data/gtm.db` (`GTM_SQLITE_PATH`).

### Configuration

All settings come from environment variables; `.env.example` lists them with comments. Notable ones:

| Variable                                          | Purpose                                                        |
| ------------------------------------------------- | -------------------------------------------------------------- |
| `LLM_PROVIDER`                                    | `fake` (development and tests) or `anthropic`. Production refuses `fake`. |
| `ANTHROPIC_API_KEY`                               | Needed only for `anthropic`. Comes from the secret manager in production. |
| `RESEARCH_RUN_COST_CAP`, `RESEARCH_ACCOUNT_MONTHLY_CAP` | Hard cost limits per run and per account per month.      |
| `RESEARCH_WEB_FETCH_ENABLED`                      | Off by default. When on, fetches https pages from approved hosts only. |
| `HYPOTHESIS_STALE_DAYS`                           | Age after which a hypothesis counts as stale.                  |

Numeric defaults are hypotheses and are tracked in the
[open questions](netspective-hde-gtm-engine/docs/context/05-open-questions.md).

## Documentation

| Document                                                                                | Contents                                         |
| --------------------------------------------------------------------------------------- | ------------------------------------------------ |
| [Source prompt](netspective-hde-gtm-engine/docs/context/00-source-prompt.md)            | Business source of truth                         |
| [Guardrails](netspective-hde-gtm-engine/docs/context/01-guardrails.md)                  | Non-negotiable rules, ICPs, offers, SQL rules    |
| [Glossary](netspective-hde-gtm-engine/docs/context/02-glossary.md)                      | Shared terms                                     |
| [Feature map](netspective-hde-gtm-engine/docs/context/03-feature-map.md)                | Feature order and dependencies                   |
| [Acceptance scenarios](netspective-hde-gtm-engine/docs/context/04-acceptance-scenarios.md) | Synthetic scenarios used in tests             |
| [Open questions](netspective-hde-gtm-engine/docs/context/05-open-questions.md)          | Assumptions awaiting a decision                  |
| [Architecture overview](netspective-hde-gtm-engine/docs/architecture/overview.md)       | System structure                                 |
| [ADRs](netspective-hde-gtm-engine/docs/adr)                                             | Architecture decisions                           |
| [Constitution](netspective-hde-gtm-engine/.specify/memory/constitution.md)              | Project governance                               |

## Contributing

1. Read the constitution and the guardrails before starting.
2. Work in small vertical slices on a feature branch and keep tests green.
3. Use synthetic data only. Record gaps in the open questions rather than inventing facts.
4. Update the feature's spec when behaviour changes.
5. Open a pull request; CI must pass before merge.

## License

Internal use. No license is granted for external use.
