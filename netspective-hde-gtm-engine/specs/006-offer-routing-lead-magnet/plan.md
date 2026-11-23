# Implementation Plan: Offer Routing and Lead Magnet

**Branch**: `006-offer-routing-lead-magnet` | **Date**: 2026-11-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-offer-routing-lead-magnet/spec.md` (clarified 2026-11-23)

## Summary

Turn evidence into one explained offer recommendation and open a controlled front door for prospects. A **routing engine** (a pure function over a versioned rule set held as data) decides eligibility first (ICP exclusion, suppression, consent, offer availability, capacity) and then the outcome (Offer 1, 6, 5, another approved offer, research or no action); an AI contract may only explain or order the offers that remain. **Public forms** (hosted pages plus an embeddable submission endpoint) take the Offer 5 register download, the 30-minute working session request and the Offer 1 and Offer 6 intakes, behind a signed form token, a honeypot, a minimum time, rate limiting, a CORS allow-list and the PHI guard. A download resolves or creates the account and contact, records first-party engagement and consent against an approved notice version, delivers the register through an expiring link, and queues a follow-up recommendation for a person; nothing is ever sent.

Technical approach (details in [research.md](research.md)): follow the feature 001 to 005 architecture. Work lands in `offers`, `engagement` and `workshops`, with `contacts` and `icp` filled in from feature 002 (see below). Pure rules in `packages/domain/src/{routing,workshops}` and the suppression and ICP rules in `packages/domain/src/{contacts,icp}`; persistence on the interim SQLite adapter behind `Tx` (ADR-015) with forward-only migrations `0020`–`0022`; audit in the same transaction as every change; events through the outbox; the PHI guard on every free-text field.

**Important decisions and departures**: (1) **feature 002 is only partly built** (accounts import and duplicate review are done; contacts, the suppression check and ICP fit have tables but no code), so the minimal slice 006 needs is built here, first, and recorded against 002's tasks (R-02); (2) `engagement` reaches `offers` through a recommender port wired at the composition root, so the two modules do not depend on each other in a cycle (R-01); (3) the explanation call reuses the existing `ai_invocation` task and context values, so no table is rebuilt, and its input carries no external text (R-06); (4) two official Fastify plugins (CORS, rate limiting) and Playwright are new dependencies (R-08, R-17); (5) the register file and the notice and consent wording are supplied by the business and are not in the repository, so the form is unavailable until a notice version is approved and a missing file is a recorded delivery failure (R-09, R-10); (6) the first rule set, thresholds and role mapping are hypotheses (open question #51).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged)

**Primary Dependencies**: Fastify 5 + zod-to-openapi, Zod 4, `node:sqlite` via `@gtm/db`, uuid v7, Next.js / React for the screens. **New**: `@fastify/cors`, `@fastify/rate-limit` (API) and `@playwright/test` (web, development only).

**Storage**: interim SQLite (ADR-015); migrations `0020_routing.sql`, `0021_engagement.sql`, `0022_intake.sql`; triggers refuse UPDATE and DELETE on the append-only tables in [data-model.md](data-model.md); every new column registered in `COLUMN_CLASSIFICATION`. A local-disk file store holds the register (key `REGISTER_FILE_KEY` under `FILE_STORAGE_DIR`).

**Testing**: Vitest (unit, integration, contracts). Table-driven tests over the case corpus `tests/fixtures/routing/cases.json` (every rule's match, near-miss and precedence, plus every eligibility code), the supported-hypothesis function, the intake schemas and `looksLikeFieldName` over `tests/fixtures/intake/field-names.json`, the abuse checks (token, honeypot, minimum time, rate limit, CORS), consent and notice versions, account and contact resolution including personal email, the register link signing and expiry, and the AI step with the fake model (a ranking outside the eligible set is rejected and falls back). OpenAPI contract tests with the existing helper; Testing Library for the panel, inbox and hosted pages; the always-on Scenario C and G integration test; a Playwright test for Scenario C run on request (`pnpm test:e2e`).

**Target Platform**: Linux (same containers as 001–005). No new job is required.

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: a recommendation (without the AI step) in under 500 ms for one account; the public form page and a submission respond in under 1 second excluding the AI-free follow-up; the register link resolves in under 300 ms.

**Constraints**: non-PHI business data only (PHI guard on every free-text value, a refusal stores nothing); no model call in any eligibility or routing decision; no automatic send of any kind; a download is never intent or an SQL; consent is never a condition of receiving the register; no price, budget, credential or production-data field on any form; events carry identifiers only; the public group has no cookies, no session and no permission model, so everything it accepts is untrusted.

**Scale/Scope**: a few downloads and requests per day; 3 public slugs; 7 rules in rule set v1; 3 new tables groups; 3 contracts (15 paths); 3 events; 7 new permissions; 2 screens and 1 hosted page set.

Numeric defaults (24-hour link, 3-second minimum, 24-hour token age, 60-second dedupe, rate limits of 20 and 120 per minute, supported confidence band `medium`) are hypotheses, configurable, listed in research R-18 and open question #51.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | A recommendation routes only on supported hypotheses (current approved evidence); a download is engagement, never a conclusion. | Pass |
| II | Buyer-confirmed vs assumption | Facts used are listed with their evidence status; unknown inputs appear in the limitations. | Pass |
| III | Provenance | Every recommendation records the rule set version, matched rules, inputs hash and who reviewed it; consent records the notice version shown. | Pass |
| IV | Non-PHI by default | The guard runs on every public and intake field; a refusal stores and logs nothing and notifies the operator; the AI input has no external text. | Pass |
| V | No unsupported claims | Form copy and notice text are separate approved versions; the register page makes no claim beyond the approved wording. | Pass |
| VI | ICP focus | Excluded ICP fit blocks outreach by rule; no silent broadening. | Pass |
| VII | Buyer value before volume | No automatic send; weak or unsupported evidence leads to research or no action. | Pass |
| VIII | Human approval | Recommendations, requests and wait-list entries wait for a person; rule activation and notice approval need restricted permissions held by people. | Pass |
| IX | Deterministic rules | Eligibility, routing, supported-hypothesis, consent and suppression checks, capacity, the PHI guard and the field-names rule are plain code with table tests. | Pass |
| X | Structured AI outputs | One schema-validated contract; a ranking outside the eligible set is rejected and replaced by the deterministic order. | Pass |
| XI | Untrusted input | Every public value is untrusted: bounded, guarded and never executed; no page or visitor text reaches a model. | Pass |
| XII | Explainable | Each recommendation lists eligible and excluded offers with codes, matched rules, alternatives and limitations. | Pass |
| XIII | Capacity first-class | The 005 capacity answer removes a full offer and offers alternatives and a wait-list. | Pass |
| XIV | Privacy and minimisation | Email kept only where review needs it; keyed hash for suppression; events and logs carry identifiers only. | Pass |
| XV | Provider independence | File storage and the model sit behind provider interfaces with fakes and adapters. | Pass |
| XVI | Modular monolith | Public indexes only; the engagement and offers cycle is broken by a port (R-01). | Pass |
| XVII | Test before autonomous action | Routing corpus first; rule activation is gated on it; no autonomous action exists. | Pass |
| XVIII | Hypotheses labelled | The rule set, thresholds, link lifetime, rate limits and role mapping are labelled hypotheses. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotent handlers, correlation IDs, redacted logs | Same mechanisms; the new signing keys are secrets, scrubbed from logs. | Pass |
| Security baseline | RBAC, audit every change, TLS | 7 new permissions; audit in-transaction including refusals; the public group is rate limited and origin checked. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` | New pure code covered by table tests and the corpus. | Pass |

**Gate result (pre-research)**: PASS, with the 002 slice and the new dependencies recorded under Complexity Tracking.

**Post-design re-check**: PASS. Items flagged for confirmation (open question #51): the 002 slice built here (R-02); rule set v1 and its precedence (R-03); the supported-hypothesis definition (R-05); the AI step off by default (R-06); the new dependencies (R-08, R-17); the role mapping (R-16).

## Project Structure

### Documentation (this feature)

```text
specs/006-offer-routing-lead-magnet/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 to R-20
├── data-model.md        # Phase 1: tables, typed payloads, states, events, permissions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── public.openapi.yaml
│   ├── routing.openapi.yaml
│   └── engagement.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/domain/src/
├── routing/{types,rules,supported,eligibility,evaluate,explain}.ts   # pure: rule schema, evaluator, supported hypothesis, template explanation
├── workshops/intake.ts                                               # pure: Offer 1 and Offer 6 schemas, looksLikeFieldName
├── contacts/{suppression,validate-contact}.ts                        # feature 002 slice: suppression primitives, contact validation
├── icp/{types,defaults,definition,evaluate,eligibility}.ts           # feature 002 slice: definitions, evaluator, priority eligibility
└── events/feature006.ts                                              # strict event payload schemas
packages/ai-contracts/src/
├── offer-recommendation.ts                                           # offer-recommendation-explain@1.0.0 schema
└── prompts/offer-explain.md                                          # versioned prompt
packages/providers/src/
├── interfaces/file-storage.ts  fakes/file-storage.ts  adapters/local-file-storage.ts   # slice of feature 001's storage provider
packages/db/
├── migrations-sqlite/0020_routing.sql  0021_engagement.sql  0022_intake.sql
├── src/seed/feature006.ts      # routing rule set v1 (hypothesis)
└── src/classification.ts       # + all new tables and columns
apps/api/src/modules/
├── contacts/{repository,suppression,service,index}.ts                # feature 002 slice
├── icp/{repository,assessments,index}.ts                             # feature 002 slice
├── offers/{routing-context,recommendations,rule-sets,waitlist,recommendation-routes,events}.ts   # + index exports
├── engagement/{notice,consent,requests,public-forms,public-routes,abuse,delivery,resolve,events,routes,index}.ts
└── workshops/{intake,index}.ts
apps/api/src/app.ts             # composition root: recommender port, public group registered
apps/api/src/catalogue-stack.ts # or a new engagement-stack.ts: services built and wired
apps/api/src/config/index.ts    # the settings in research R-18
apps/web/src/
├── app/public/offers/[slug]/{page.tsx,public-form.tsx}               # hosted forms (no session)
├── app/api/public/[...path]/route.ts                                 # unauthenticated proxy, /v1/public/* only
├── app/requests/{page.tsx,requests-view.tsx}                         # request inbox
├── app/accounts/[id]/workspace/recommendation-panel.tsx              # panel mounted in workspace-view.tsx
└── lib/{recommendations-api,requests-api,public-api}.ts
apps/web/e2e/scenario-c.spec.ts apps/web/playwright.config.ts        # Playwright (run on request)
tests/fixtures/routing/cases.json  tests/fixtures/intake/field-names.json
docs/adr/ADR-020-routing-eligibility-and-public-intake.md
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as 001–005. The stub `engagement` and `workshops` folders are filled in, and `contacts` and `icp` (stubs from feature 002) receive only the slice listed under R-02. No new package or deployable. Public functions later features call: `evaluate`, `recommend` and `priorInteractions` (offers and engagement indexes, for 007, 009 and 012), and the suppression check (contacts index, for every feature that sends).

## Dependencies and ordering

- **Feature 002 slice first** (R-02): the suppression check, contact find-or-create, ICP definitions, evaluator and eligibility are built before routing, because the routing context reads them. The tasks note which of 002's tasks they close.
- **Feature 004**: the hypothesis effective status and evidence view feed the supported-hypothesis function. **Feature 005**: the offer in-force status, `capacityStatus` and the offer keys used as slugs.
- **Order**: 002 slice, then the pure routing engine and its corpus (test first), then rule sets and recommendations, then notice, consent and the public group, then intake and delivery, then screens and the end-to-end test.
- Feature 007 will book the sessions that requests lead to; feature 009 will send follow-ups and own wider email permission; feature 012 will turn accepted recommendations into next best actions.

## Complexity Tracking

| Item | Why it is needed | Simpler alternative rejected because |
|---|---|---|
| Building the feature 002 slice here | Routing must honour suppression, ICP exclusion and fit, none of which has code yet | Finishing all of 002 first adds about sixty unrelated tasks; stubs would fork the rules |
| Two new Fastify plugins | CORS and rate limiting are security controls | Hand-written versions are easy to get wrong |
| Playwright | The description asks for an end-to-end test of Scenario C | An HTTP integration test of the same scenario also runs always, so the browser test stays optional |
| A recommender port between engagement and offers | The two modules would otherwise depend on each other | An event would not let the download show its follow-up in the same request |
