# ADR-004: Non-PHI GTM data boundary

- **Status**: Proposed (accept after human review of the Feature 001 plan)
- **Date**: 2026-11-02
- **Feature**: 001
- **Related principles**: IV Non-PHI by default; IX Deterministic rules; XI Untrusted input; XIV Privacy and data minimisation

## Context
The engine supports sales motions for healthcare data engineering. It has no legitimate need for PHI, patient-level data or credentials, and any exposure would be a severe incident. Content arrives through the API, uploads, webhooks, provider responses and user interface input.

## Decision
PHI, patient-level data and credentials are the `prohibited` classification. A deterministic, versioned detector pipeline in `packages/domain/privacy` returns a decision (allow, reject or quarantine) with rule IDs and never the matched content. It is applied at: API bodies and uploads, webhook ingress, provider calls, the LLM-gateway pre-flight, log serialisation, and audit-summary writing. Default action is reject. Quarantine, for sources explicitly configured for review, holds content encrypted, time-limited and accessible only to the `quarantine.review` permission, with every access and decision audited. Unclassifiable content is treated as suspected. Every stored field declares a data classification.

## Alternatives considered
- **LLM-based detection**: nondeterministic and would send suspected PHI to a model. Rejected.
- **Third-party DLP service**: data egress and a provider dependency. Rejected.
- **Regex only**: misses structural patterns such as tabular rows. Rejected.
- **Guard at the API edge only**: misses logs, prompts and provider calls. Rejected.

## Consequences
- Positive: one shared guard, testable, with a fixture set for Scenario D.
- Negative: false positives need a reviewer path; detector tuning is ongoing and is handled by versioned changes.
- Open items for clarification: reject versus quarantine policy, quarantine reviewer role, user-interface coverage and detectors for credentials.
