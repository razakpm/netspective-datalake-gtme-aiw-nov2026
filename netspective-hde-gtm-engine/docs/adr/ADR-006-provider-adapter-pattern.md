# ADR-006: Provider adapter pattern

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: XV Provider independence; IV Non-PHI by default; XVII Test before autonomous action

## Context
Provider choices (LLM, email, calendar, CRM, enrichment, research sources, hosting) are open questions. Tests must be hermetic and must never make real external calls.

## Decision
All external services sit behind interfaces in `packages/providers`: ResearchSourceProvider, PublicDataProvider, ContactEnrichmentProvider, LLMProvider, EmailProvider, CalendarProvider, CRMProvider, FileStorageProvider. Each has a fake implementation and a shared contract-test suite that runs against every implementation. Calls pass through a wrapper that applies the PHI guard, maps failures to typed results, and propagates the correlation ID. Vendor SDKs are importable only inside adapters (lint-enforced). Production start-up refuses fake implementations.

## Alternatives considered
- **Direct SDK use in modules**: faster initially, but lock-in and untestable. Rejected.
- **A generic plugin framework**: over-engineered for eight known interfaces. Rejected.

## Consequences
- Positive: decisions on providers can wait; tests are deterministic; contract tests protect swaps.
- Negative: interface design effort up front and per-adapter maintenance.
