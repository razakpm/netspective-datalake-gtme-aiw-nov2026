# Quickstart: Service Capabilities, Offer Catalog and Claims

A run-and-validate guide. It contains no implementation code. Details live in [contracts/](contracts/), [data-model.md](data-model.md) and [research.md](research.md).

## Prerequisites

- Features 001 to 004 running locally (interim SQLite, ADR-015), branch `005-capabilities-offers-claims`, migrations `0017`–`0019` applied.
- Seeded users: a service lead (`sales_service_lead`), a marketing approver (`campaign_approver`) and a second approver, an analyst and an administrator.
- Seed applied: phrase list version 1, ten offers, Offer 7's limitation, three paid types, 19 capability slots, capacity limits (hypotheses).

## Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|----------|------------|------------------|------|
| V1 | Checker corpus | Run `tests/fixtures/claims/corpus.json` through `POST /v1/claims/lint` | Every restricted phrase flagged with class, text and position; every clean sentence passes | FR-004, FR-005, SC-001 |
| V2 | Variants and false matches | Lint "AI ready", "AI‑ready", "slate", "page 50%" | First two flagged; last two not | FR-005 |
| V3 | Claim needs evidence | Draft a quantified-outcome claim and try to approve it | Refused (`claim_needs_evidence`); suggestion to omit | FR-003 |
| V4 | Two approvers | Approve a restricted claim with evidence as one approver, then as the drafter, then as a second approver | Stays in review; drafter refused; second approval makes it approved | FR-003, SC-002 |
| V5 | Immutable reviews | Try to change or delete a review row | Refused by the database | FR-007 |
| V6 | False positive | Mark a flag a false positive as a non-approver, then as an approver | Refused, then recorded for that sentence only | FR-007 |
| V7 | Evidence expires | Set evidence expiry in the past | The claim reads as `needs_review` and cannot cover text | FR-008 |
| V8 | Seeded catalogue | `GET /v1/offers` | Offers 1, 5, 6 approved with a "baseline, attributes incomplete" notice; 2, 3, 4, 7, 8, 9, 10 draft | FR-012 |
| V9 | New version | `PATCH /v1/offers/{id}` | New version at draft; earlier version unchanged and readable; approved version stays in force | FR-011 |
| V10 | Version history immutable | Try to update or delete an `offer_version` row | Refused by the database; hash of an old version unchanged | SC-004 |
| V11 | Status order | Move draft straight to available | Refused (`invalid_transition`) with a plain reason | FR-010 |
| V12 | Offer 7 limitation | Try to approve Offer 7 with the limitation unacknowledged; acknowledge as a service lead; retry | Refused (`limitation_unacknowledged`), then allowed past that gate; changing the wording makes the acknowledgement stale | FR-013, SC-003 |
| V13 | Placeholder gate | Try to approve an offer that has null attributes | Refused (`placeholder_attributes`) listing the missing fields | FR-012 |
| V14 | Restricted text in an offer | Put "SOC 2 certified" in a landing-page promise and try to approve | Refused (`uncovered_restricted_phrase`) until an approved claim covers the exact sentence | FR-014 |
| V15 | Capacity limit and usage | Set Offer 6 to 3 per month, book 3 sessions, ask the status | `exhausted` with limit 3, used 3, remaining 0 | FR-018, FR-019, SC-005 |
| V16 | Cancel and reschedule | Cancel one booking; reschedule another into a full month | Status returns to `room`; the reschedule into the full period is refused | FR-020 |
| V17 | No limit set | Ask the status for an offer with no limit | `no_limit_set`, never "unlimited" | FR-018 |
| V18 | Limit history | Change a limit | Old value, who and when are kept | FR-017 |
| V19 | Period edges | Book on the last and first day of a month and week, around a daylight-saving change | Counted in the right calendar period in the business time zone | FR-017 |
| V20 | Paid types | `GET /v1/paid-engagement-types` and inspect the schema | Three types with the stated scope; Resilience Review inactive; no price field | FR-024, FR-025, SC-007 |
| V21 | Unapproved deliverable | Propose a deliverable not in the source; try to use it | Stays pending until a `paid_types.approve` holder approves | FR-026 |
| V22 | Scores | `GET /v1/offer-scores` | Empty with the "to be provided" label; a recorded score shows `hypothesis` and keeps history | FR-027 |
| V23 | Capability catalogue | `GET /v1/service-capabilities` | 19 slots with placeholders marked; no delivery example in the list | FR-021, FR-022 |
| V24 | Public approval gate | Mark a capability approved with null attributes, then without evidence | Refused (`placeholder_attributes`, `no_evidence_basis`) | FR-023 |
| V25 | Examples are internal | Read a capability as an analyst, then as a holder of `capabilities.examples.read`; build the public projection | Examples only for the second; the projection never contains example text | FR-022, SC-007 |
| V26 | PHI-like text | Submit a synthetic SSN-like pattern in a claim, an example and a deliverable | Each refused whole; nothing stored or logged | FR-030 |
| V27 | Concurrent edit | Two edits with the same `lockNo` | The second returns 409 `stale_version` | Edge case |
| V28 | RBAC | Call each mutation as a role without the permission | 403 and an audited refusal | FR-028 |
| V29 | Audit and events | Perform a version, status move, review, limit change and acknowledgement | One audit record each with who; events carry identifiers only | FR-029, SC-008 |
| V30 | Scenario E and G | Run cross-feature scenario E (claims) and G (capacity) over the fixtures | Content with "AI-ready", an SLA, SOC 2 and a case-study figure is flagged and cannot be approved; Offer 6 at capacity reads `exhausted` | Scenarios E, G |

## Run

```bash
cd netspective-hde-gtm-engine
pnpm test                 # checker corpus, status machine, gate, capacity tables
pnpm test:integration     # versioning, immutability, RBAC, audit, events, seed
pnpm test:contracts       # claims, offers and capabilities contracts
pnpm lint && pnpm typecheck && pnpm format
```

All numeric defaults, scores, effort estimates and the role mapping are hypotheses (open question #48).
