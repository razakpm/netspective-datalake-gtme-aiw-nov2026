# Implementation Plan: Service Capabilities, Offer Catalog and Claims

**Branch**: `005-capabilities-offers-claims-impl` (spec directory `005-capabilities-offers-claims`) | **Date**: 2026-11-19 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-capabilities-offers-claims/spec.md` (clarified 2026-11-19)

## Summary

Make what Netspective can credibly offer, and what it must not claim, explicit and versioned: a catalogue of 19 service capability slots with evidence and internal-only delivery examples; the ten engagement offers with immutable versions, per-version status, limitations that must be acknowledged, and judgement scores labelled hypothesis; capacity per offer per period computed from bookings, with an "exhausted" answer other features can query; three paid engagement types with no price field and approved deliverables only; and claim governance with evidence, two-person review of restricted claims, a versioned phrase list and a deterministic claim checker. Publishing pages and pricing are out of scope.

Technical approach (details in [research.md](research.md)): follow the feature 001–004 architecture. Three new modules `claims`, `offers` and `capabilities` in `apps/api` (claims is its own module, [ADR-019](../../docs/adr/ADR-019-claim-evidence-governance.md)), pure rules in `packages/domain/src/{claims,offers}`, persistence on the interim SQLite adapter behind `Tx` (ADR-015) with forward-only migrations `0017`–`0019`, immutability by database triggers, audit in the same transaction as every state change, events through the outbox, the PHI guard on every free-text field. **Important decisions and departures**: (1) the business source for the 19 capabilities, ten offers and scoring table is not in the repository, so the seed holds only what the repository records and uses null as the "to be provided" placeholder (R-02); (2) Offers 1, 5 and 6 are seeded `approved` once by the actor `seed` while the placeholder gate applies to every later move, which resolves a conflict between FR-012 and the gate (R-02); (3) status belongs to an offer **version**, so a correction can be reviewed while the old version stays in force (R-03); (4) capacity usage is **computed** from bookings, not a stored `used` counter (R-08); (5) there is no "delivery lead" role, so capacity belongs to `sales_service_lead` (R-12); (6) feature 004's provisional capability list stays until names exist (R-02).

## Technical Context

**Language/Version**: TypeScript (strict) on Node.js 22 LTS; pnpm workspaces (unchanged)

**Primary Dependencies**: no new runtime dependencies. Fastify 5 + zod-to-openapi, Zod 4, `node:sqlite` via `@gtm/db`, uuid v7, `Intl.DateTimeFormat` for business-time-zone periods, Next.js / React for the screens.

**Storage**: interim SQLite (ADR-015); migrations `0017_claims.sql`, `0018_offers.sql`, `0019_capabilities.sql`; triggers refuse UPDATE and DELETE on the append-only tables listed in [data-model.md](data-model.md); every new column registered in `COLUMN_CLASSIFICATION` (delivery examples as `internal_case_study_restricted`).

**Testing**: Vitest (unit, integration, contracts). Table-driven tests for the claim checker over the corpus `tests/fixtures/claims/corpus.json`, the offer status machine and gate, claim approval rules, capacity periods (month and week edges, daylight saving, reschedule, cancel, no-show), score range, and the no-price schema test; integration tests for versioning and immutability, Offer 7's limitation, the seed, RBAC, audit, events and the exhausted query; OpenAPI contract tests with the existing helper; Testing Library for the three screens; the cross-feature scenarios E (claims) and G (capacity).

**Target Platform**: Linux (same containers as 001–004). No new job is required; claim staleness is computed at read, and an optional daily job only materialises it.

**Project Type**: Web application, modular monolith (`apps/api`, `apps/web`, `packages/*`).

**Performance Goals**: the capacity status for one offer returns in under 200 ms; the catalogue screen lists 10 offers and 19 capabilities in under 2 seconds; the checker runs over 20,000 characters in under 50 ms.

**Constraints**: non-PHI business data only (PHI guard on every free-text field); no model call in any rule (checker, gates, approvals, capacity, scores); no price, fee, rate or currency column anywhere in this feature; internal delivery examples never reach a public projection; claims default to omission; every version, review and limit change is append-only.

**Scale/Scope**: 10 offers, 19 capabilities, 3 paid types, dozens of claims, a few bookings per week; 3 modules; 3 contracts (29 paths); 6 events; 3 screens.

Numeric defaults (capacity limits 3 per month and 3 per week, score scale 1 to 5, evidence expiry 12 months, time zone `UTC`) are hypotheses, configurable, listed in research R-08, R-09, R-16 and open question #48.

## Constitution Check

*GATE: passes before research; re-checked after Phase 1 design (end of section).*

| # | Principle | Plan response | Status |
|---|---|---|---|
| I | Evidence before inference | Claims and public-claim status need linked evidence; capabilities need an evidence basis before public approval. | Pass |
| II | Buyer-confirmed vs assumption | n/a (no buyer facts stored here). | n/a |
| III | Provenance | Every version, status move, review, acknowledgement, limit change and score has who, when and why; versions are hashed snapshots. | Pass |
| IV | Non-PHI by default | PHI guard on every free-text field; refusals store nothing. | Pass |
| V | No unsupported claims | The whole feature: restricted classes, evidence, two-person review, checker, default omission, gate on offer approval. | Pass |
| VI | ICP focus | Offers reference an ICP and SQL rule by identifier; excluded ICPs are not added. | Pass |
| VII | Buyer value before volume | n/a. | n/a |
| VIII | Human approval | Approvals need `claims.approve` or `paid_types.approve` (restricted, humans only); the seed is the only non-human approval and is labelled. | Pass |
| IX | Deterministic rules | Checker, status machine, gate, claim approval, capacity and periods are pure code in `packages/domain` with table tests; no model anywhere. | Pass |
| X | Structured AI outputs | n/a (no AI output; later features may draft claims through the checker). | n/a |
| XI | Untrusted input | Text from users is checked, never executed; checker input is bounded. | Pass |
| XII | Explainable | Refusals carry stable codes and plain messages; capacity status shows limit, used and remaining. | Pass |
| XIII | Capacity first-class | Limits per offer and period, computed usage, an exhausted answer for routing. | Pass |
| XIV | Privacy and minimisation | Delivery examples internal-only; identifiers-only events and logs. | Pass |
| XV | Provider independence | n/a (no provider). | n/a |
| XVI | Modular monolith | Three modules with public indexes; claims independent of offers and capabilities; events for other modules. | Pass |
| XVII | Test before autonomous action | Test-first tasks for the checker corpus, status machine, gate and capacity before services. | Pass |
| XVIII | Hypotheses labelled | Effort estimates, scores, capacity limits, phrase list defaults, role mapping and periods are labelled hypothesis. | Pass |
| Eng. standards | strict TS, forward-only migrations, idempotent handlers, correlation IDs, redacted logs | Same mechanisms as 001–004; idempotency keys on every mutation. | Pass |
| Security baseline | RBAC, audit every change | 15 new permissions (R-12); audit in-transaction including refusals. | Pass |
| Quality gates | clarify ✔, analyze, converge; 80% coverage on `packages/domain` | New pure code covered by table tests and the corpus. | Pass |

**Gate result (pre-research)**: PASS. No violations; Complexity Tracking is empty.

**Post-design re-check**: PASS. Items flagged for confirmation (open question #48): three modules with claims separate (R-01); null as the placeholder and the one-time seeded approval (R-02); status per version (R-03); exact-sentence claim cover (R-04); computed capacity usage and the `UTC` default (R-08); role mapping with `sales_service_lead` as delivery lead (R-12).

## Project Structure

### Documentation (this feature)

```text
specs/005-capabilities-offers-claims/
├── plan.md              # This file
├── research.md          # Phase 0: decisions R-01 to R-16
├── data-model.md        # Phase 1: tables, constraints, state transitions, events, permissions
├── quickstart.md        # Phase 1: run and validation guide
├── contracts/           # Phase 1: OpenAPI 3.1 contracts
│   ├── claims.openapi.yaml
│   ├── offers.openapi.yaml
│   └── capabilities.openapi.yaml
├── checklists/requirements.md
└── tasks.md             # Phase 2 (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
packages/domain/src/
├── claims/{linter,phrases,normalise,approval,types}.ts   # pure: checker, default rules, approval rule
├── offers/{status,gate,capacity,period,types}.ts         # pure: status machine, gate, periods, usage
└── events/feature005.ts                                   # strict event payload schemas
packages/db/
├── migrations-sqlite/0017_claims.sql  0018_offers.sql  0019_capabilities.sql
├── src/seed/feature005.ts            # phrase list v1, offers, limitation, paid types, 19 slots, capacity (hypotheses)
└── src/classification.ts             # + all new tables/columns
apps/api/src/modules/
├── claims/{repository,service,review,evidence,queries,routes,events,index}.ts
├── offers/{repository,service,status,limitations,capacity,bookings,scores,paid-types,routes,events,index}.ts
└── capabilities/{repository,service,projection,routes,events,index}.ts
apps/api/src/app.ts                 # composition root: three services, routes registered
apps/api/src/config/index.ts        # BUSINESS_TIME_ZONE, OFFER_SCORE_MIN/MAX, CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS
apps/web/src/app/
├── offers/{page.tsx,offers-view.tsx}            # Offer Workspace v1
├── capabilities/{page.tsx,capabilities-view.tsx} # Capability catalogue
└── claims/{page.tsx,claims-view.tsx}            # Claim review queue
apps/web/src/lib/{offers-api,capabilities-api,claims-api}.ts
tests/fixtures/claims/corpus.json    # positive and negative checker cases with class and position
tests live beside each package: packages/*/test, apps/api/test (integration, contract), apps/web/test
docs/adr/ADR-019-claim-evidence-governance.md
```

**Structure Decision**: Option 2 (web application / modular monolith) exactly as 001–004. The stub `capabilities` and `offers` module folders are filled in and `claims` is added. No new package, service or deployable. Public functions that later features call: `capacityStatus`, `recordBooking`, `rescheduleBooking`, `cancelBooking` (offers index, for 006 and 007) and `lintText` plus claim lookup (claims index, for 009).

## Dependencies and ordering

- **Feature 004 (PR #10)** adds migrations `0014`–`0016` and edits the same shared files (permissions, seeds, classification, composition root). Feature 004 is already on `main` (PR #10), so migrations `0017`–`0019` follow `0016` directly (research R-14).
- Feature 006 reads `capacityStatus`; feature 007 writes bookings; feature 008 reads paid engagement types; feature 009 reads claims and the checker.
