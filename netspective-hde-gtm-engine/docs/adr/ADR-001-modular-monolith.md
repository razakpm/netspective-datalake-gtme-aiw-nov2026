# ADR-001: Modular monolith

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: XVI Modular monolith first; XV Provider independence; IX Deterministic rules

## Context
The GTM Engine is an internal tool for a small team with an unproven product. It needs transactional consistency between state changes, audit events and domain events, and it must be cheap to run and change. Open questions on hosting (#16) are unresolved.

## Decision
One deployable API codebase that runs HTTP and worker roles from the same image, plus one internal web app. Shared code lives in `packages/{domain,ai-contracts,providers,db}`. Module boundaries inside `apps/api/src/modules` are enforced by `eslint-plugin-boundaries`: modules interact only through each other's public `index.ts` and domain events. Splitting out a service requires a new ADR.

## Alternatives considered
- **Microservices**: independent scaling and deployment, but heavy operational cost and distributed-transaction problems for audit and outbox. Rejected.
- **Single full-stack Next.js app**: fewer deployables, but the worker role, webhook ingress and API contract are harder to separate. Rejected.
- **Unstructured monolith**: fastest start, but boundaries erode; rejected in favour of enforced modules.

## Consequences
- Positive: simple deployment, in-transaction audit and outbox, easy local run.
- Negative: scaling is by whole-process replication; discipline (and lint) is needed to keep boundaries.
- Follow-up: lint configuration is a Feature 001 task; empty module stubs exercise the rules from day one.
