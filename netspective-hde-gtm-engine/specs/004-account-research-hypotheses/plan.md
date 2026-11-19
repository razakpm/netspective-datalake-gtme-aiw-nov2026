# Implementation Plan: Account Research and Hypotheses

**Branch**: `004-account-research-hypotheses` | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-account-research-hypotheses/spec.md` (clarified 2026-11-19)

## Summary

Deliver bounded, auditable account research and evidence-backed hypotheses: a research run with a source and cost budget that reads only approved sources and records every fetch; a schema-checked summary of facts as stated, inferences, unknowns and contradictions whose every statement is verified against the fetched text; extracted findings handed to feature 003 as unreviewed AI-extracted signals; deterministic prompt-injection detection with external content passed to the model only as delimited data and with no tools; incremental re-runs by URL and content hash; hypotheses (analyst-created or AI-proposed then accepted) with supporting and contradictory signals, buyer-confirmed facts, assumptions and banded confidence; reviewer-only status changes with the buyer-confirmed validation rule and a deterministic staleness rule; an advisory problem-interpretation agent; and a Target Account Workspace. Research never sets ICP fit, qualification or any decision.

Technical approach (details in [research.md](research.md)): follow the Feature 001–003 architecture. Two new modules `research` and `hypotheses` in `apps/api`, pure rules in `packages/domain/src/{research,hypotheses}`, Zod schemas with JSON Schema export in `packages/ai-contracts`, persistence on the interim SQLite adapter behind `Tx` (ADR-015) with forward-only migrations `0014`–`0016`, audit in the same transaction as every state change, events through the transactional outbox, the PHI guard on every outbound payload and every stored text field. **Important departure from the runbook**: the "LLM gateway from 001" does not exist yet (feature 001's provider and AI-invocation tasks T096–T109 are open and `packages/providers` is empty), so this feature builds the smallest slice of it that it needs, in the shape 001 specified: `LLMProvider` and `ResearchSourceProvider` interfaces, fakes, the provider-call wrapper, the prompt registry, the `ai_invocation` ledger and the gateway (research R-01). Other departures, all reversible: (1) runs execute as a queued job on the existing job service, not in the request; (2) provider selection is configuration (`LLM_PROVIDER`), not a `provider_connection` row; (3) the "web search/fetch adapter" is a fetch adapter over administrator-approved hosts (no search engine); (4) the attention queue is the list of runs in `needs_attention`, because feature 002's `review_item` cannot take a new kind without rebuilding the table; (5) the Anthropic adapter uses plain `fetch`, adding no dependency; (6) the validated rule requires a supporting signal that is approved **and** buyer-confirmed (slightly stricter than the spec wording).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged)

**Primary Dependencies**: no new runtime dependencies. Fastify 5 + zod-to-openapi, Zod 4 (`z.toJSONSchema` for the schema export), `node:sqlite` via `@gtm/db`, uuid v7, Next.js 15 / React 19. `apps/api` already depends on `@gtm/ai-contracts`; it gains a dependency on `@gtm/providers` (workspace). Model access is plain `fetch` inside one adapter file; vendor SDKs stay out.

**Storage**: interim SQLite (ADR-015); migrations `0014_ai_gateway.sql`, `0015_research.sql`, `0016_hypotheses.sql`; every new column registered in `COLUMN_CLASSIFICATION`. Page text is never stored (fingerprint, address, short permitted excerpt only).

**Testing**: Vitest (unit, integration, contracts). Table-driven tests for the injection scanner, citation/protected-topic verifier, budget pre-check, status machine, validated rule, staleness rule and statement rule; gateway tests with a scripted fake provider (valid, invalid, error, over-long, instruction-obeying); the prompt-injection fixture suite; OpenAPI contract tests with the existing helper; Testing Library for the workspace; end-to-end scenario tests for `northvale-hie`, `riverbend-health` and `lakeshore-hie` with the fake model.

**Target Platform**: Linux (same containers as 001–003); worker role runs `research.run`, `research.schedule` and `hypotheses.staleness`.

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: a fixture run completes in seconds with the fake model; the workspace loads an account with 200 signals and 50 hypotheses in under 2 seconds; an analyst reaches the summary of unknowns in under 5 minutes of their time and any hypothesis's evidence in under 1 minute (SC-010).

**Constraints**: non-PHI business data only; every payload to a model passes the PHI guard and the typed allow-list; no AI in any rule (budget, caps, verification, injection detection, status machine, staleness, eligibility); a model call that sees external content has no tools; the model's output never writes state without schema validation and verification; no prompt text, response text or reasoning trace is stored; no column can express qualification, funding path, ICP fit, eligibility or a numeric confidence.

**Scale/Scope**: low thousands of accounts, a few runs per account per month, up to 25 sources per run; 2 modules; 2 contracts (research and hypotheses, 17 paths); 5 new schemas; 3 events; 1 workspace screen.

Numeric defaults (10 sources, 2.00 per run, 20.00 per account per month, 2 retries, 90-day staleness, 10 s fetch timeout, 1 MiB page limit, 0.20 per interpretation) are hypotheses, configurable, listed in research R-03, R-04, R-09, R-12 and R-14.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | Every finding cites a fetched source and a quote verified against its text; inferences list the facts they rest on; hypotheses always carry supporting and contradictory lists. | Pass |
| II | Buyer-confirmed vs assumption | Findings and extracted signals can only be `ai_hypothesis` or `derived_interpretation`; buyer-confirmed facts are the linked signals recorded by a person; assumptions are stored apart and never shown as facts; a database trigger enforces the validated rule. | Pass |
| III | Provenance | Every fetch, model attempt, prompt version, model and cost is recorded; signals keep 003's provenance chain; proposals keep the AI's original wording and model. | Pass |
| IV | Non-PHI by default | PHI guard on fetched pages, buyer statements, every stored text field and every outbound model payload; blocked content is never stored or logged. | Pass |
| V | No unsupported claims | No outward content. Hypothesis statements asserting qualification, funding path or budget as established are refused by rule. | Pass |
| VI | ICP focus | Research never changes ICP fit or eligibility; hypotheses on excluded or held accounts carry "not for prioritisation". | Pass |
| VII | Buyer value over volume | Costs and caps are per run and per account; unknowns are first-class. | Pass |
| VIII | Human approval | AI proposals need analyst acceptance; status changes need a reviewer and note; AI actors cannot accept, review or validate. | Pass |
| IX | Deterministic rules | Budget, caps, fetch approval, injection detection, verification, state machine, staleness and eligibility are pure code in `packages/domain` with table tests; boundary lint keeps them free of provider and AI imports. | Pass |
| X | Structured AI outputs | Zod schemas with versions and JSON Schema export; validation, bounded repair-retry, then escalation; no reasoning field exists in any schema. | Pass |
| XI | Untrusted input | Delimited data blocks with a per-call boundary, empty tool allow-list, rule-based injection flags (rule ids only), citation verification; the fake model is scripted to obey injections to prove they cannot act. | Pass |
| XII | Explainable | Summaries separate facts, inferences, unknowns and contradictions; bands carry explanations; the workspace drills into evidence. | Pass |
| XIII | Capacity | n/a. | n/a |
| XIV | Privacy and minimisation | A typed `ModelInput` holds only allow-listed fields; contact personal data and citation-only excerpts have no field. | Pass |
| XV | Provider independence | `LLMProvider` and `ResearchSourceProvider` interfaces; fakes for tests; vendor details only inside two adapter files; production refuses the fake. | Pass |
| XVI | Modular monolith | New `research` and `hypotheses` modules with public indexes; signals reached only through the 003 module's public functions; events for other modules. | Pass |
| XVII | Test before autonomous action | Test-first tasks for every rule; the injection and invalid-output suites run before the runner is written; the run job is autonomous only inside its budget. | Pass |
| XVIII | Hypotheses labelled | Budget, caps, retries, staleness window, source kinds, capability list and categories are stored or shown with a hypothesis label. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotent handlers, correlation IDs, redacted logs | Same mechanisms as 001–003; the run job is idempotent by run id; correlation ids propagate into provider calls. | Pass |
| Security baseline | RBAC, audit every change, encryption, SSRF | New permissions (R-16); audit in-transaction incl. refusals; fetch adapter SSRF guard (R-09); API key read from the environment by name. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` and `packages/ai-contracts` | New pure code covered by table tests; schemas covered by fixture validation. | Pass |

**Gate result (pre-research)**: PASS. No violations; Complexity Tracking is empty. (Building the gateway slice here is scope the runbook assumed away, not a violation; it is called out in the Summary and research R-01.)

**Post-design re-check**: PASS. Items flagged for confirmation (open question #46): the minimal 001 slice is built here (R-01); validated needs an approved buyer-confirmed supporting signal (R-11); worst-case budget pre-check in integer micro-units (R-03); only fetching and manual capture, no search engine (R-09); a finding must quote text that occurs in its source (R-07); the provisional capability list and hypothesis categories (R-14).

## Project Structure

### Documentation (this feature)

```text
specs/004-account-research-hypotheses/
├── plan.md              # This file
├── research.md          # Phase 0: decisions, rationale, alternatives
├── data-model.md        # Phase 1: tables, constraints, state transitions
├── quickstart.md        # Phase 1: run and validation guide (V1–V22)
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── research.openapi.yaml
│   └── hypotheses.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/ai-contracts/src/
├── research.ts          # SignalExtraction, AccountResearchSummary, AccountHypothesis (proposal), ServiceCapabilityMatch, ProblemInterpretation
├── registry.ts          # schema id+version registry, JSON Schema export (z.toJSONSchema), prompt identifiers
├── prompts/             # versioned prompt files: research-extract, research-synthesise, hypothesis-propose, problem-interpret
├── fixtures/            # example fixtures that must validate against each schema
└── index.ts             # (signal-extraction.ts from 003 stays: SignalSubmission)
packages/providers/src/
├── interfaces/{llm,research-source}.ts      # typed ProviderResult; no vendor types
├── fakes/{llm,research-source}.ts           # scriptable: valid, invalid, error, over-long, instruction-obeying; token counts
├── adapters/{anthropic-llm,web-fetch}.ts    # plain fetch; SSRF guard; the only places vendor/network details live
├── wrapper.ts                               # PHI guard on outbound payloads, correlation propagation, no payload in logs
└── index.ts
packages/domain/src/
├── research/{injection,sources,budget,verify,questions,types}.ts   # pure rules
└── hypotheses/{statement,status,staleness,confidence}.ts           # pure rules
packages/db/
├── migrations-sqlite/0014_ai_gateway.sql  0015_research.sql  0016_hypotheses.sql
├── src/seed/feature004.ts                  # hypothesis categories, provisional capabilities, prompt versions (hypothesis)
└── src/classification.ts                   # + all new tables/columns
apps/api/src/modules/
├── providers/llm-gateway.ts                # prompt/data channels, tool allow-list, structured mode, validate+repair-retry, cost, prompt registry (from 001 US8)
├── research/{service,runner,fetch,sources,summary,handoff,interpret,schedule,routes,events,index}.ts
└── hypotheses/{service,review,staleness,queries,routes,events,index}.ts
apps/api/src/app.ts (composition root: provider by LLM_PROVIDER, gateway, research/hypothesis/source services, job service injected)
apps/api/src/worker/ (register research.run, research.schedule, hypotheses.staleness)
apps/web/src/app/accounts/[id]/workspace/{page.tsx,workspace-view.tsx}   # Target Account Workspace v1
apps/web/src/lib/{research-api,hypotheses-api}.ts
tests/fixtures/{research-pages,prompt-injection}/                        # synthetic pages and injection corpus
tests/fixtures/synthetic-orgs/expected.json                              # + research expectations
tests/{unit,integration,contracts}/…                                      # per module, plus an end-to-end scenario test
docs/adr/ADR-018-research-gateway-and-untrusted-content.md
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as 001–003. The empty `research` and `hypotheses` module stubs are filled in and `packages/providers` (empty) receives the two interfaces this feature needs. No new deployable, package or service. The workspace route is independent of feature 002's account screens (not built yet) and reuses 003's `SignalTimeline`.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
