# Quickstart: Signals and Evidence

A run-and-validate guide. It contains no implementation code. Details live in [contracts/](contracts/), [data-model.md](data-model.md) and [research.md](research.md). All data is synthetic (`tests/fixtures/synthetic-orgs/`); no real sources or credentials are used.

## Prerequisites

- Features 001 and 002 running locally (interim SQLite, ADR-015), branch `003-signals-evidence`.
- Accounts imported from `tests/fixtures/synthetic-orgs/organisations.csv` (feature 002 quickstart V1).
- Seeded users: a research analyst (records), a technical SME reviewer (reviews) and an administrator.
- Migrations `0011`–`0013` applied (`pnpm db:migrate`); taxonomy version 1 seeded (hypothesis defaults).

## 1. Load the synthetic signals

`tests/fixtures/synthetic-orgs/signals.json` (created as the first task of this feature) holds fictional signals for the synthetic organisations: multi-format senders and an implementation-guide change for `northvale-hie`; a stalled pilot and traceability questions for `riverbend-health`; generic AI interest for `summitcare-health`; two **conflicting public sources of equal reliability** for `lakeshore-hie`; a grant announcement and a buyer statement of approved budget for `coastal-hie`; the same RFP on two portals; undated, over-length-excerpt, no-storage and PHI-like cases.

## 2. Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|----------|------------|------------------|------|
| V1 | Source required | `POST /v1/signals` without a source reference, then with an unknown type, unknown account, and a contact from another account | Each refused with its specific reason; nothing saved | FR-002, FR-003, FR-006 |
| V2 | Record a signal | Record a `northvale-hie` signal with source, type, observation | 201, pending review, taxonomy version stored, all provenance fields present (missing optional ones shown as "not recorded") | FR-001, FR-007 |
| V3 | Observation is not a conclusion | Record "this organisation is a strong ICP fit" as an observation; inspect the signal and schema | Stored as plain observation; no field exists for fit, hypothesis, intent, funding path or buyer decision | FR-005 |
| V4 | PHI-like text | Submit a synthetic SSN-like pattern in observation, excerpt and a note | Each refused whole; nothing stored, logged or echoed; audit event holds rule IDs only | FR-016, SC-005 |
| V5 | Excerpt limits | Submit an over-length excerpt, and an excerpt for a citation-only source | Excerpt not stored; reason shown (`too_long` / `source_no_storage`); citation intact | FR-017–FR-019, SC-006 |
| V6 | Idempotent re-submit | Submit the same signal twice | Second returns 200 `already_exists`; zero new rows, zero new provenance entries | FR-021, SC-002 |
| V7 | Near-duplicate and republication | Submit a lightly reworded copy from the same source; then the same RFP from a second portal | First merges (one signal, provenance entry); second is one signal with two sources, counted as one independent source | FR-020, FR-023, SC-003 |
| V8 | Approved signal plus merge | Approve a signal, then merge a duplicate | Stays approved, observation unchanged, flagged "new provenance since review" until cleared | FR-024 |
| V9 | Review rules | As the reviewer: approve; reject without a reason; reject with a reason; as the analyst try to approve | Approve works; reject without reason refused; rejected leaves current evidence but stays in history; analyst refused and audited | FR-025, FR-026, FR-030 |
| V10 | Contradiction at equal reliability | Mark the two `lakeshore-hie` signals contradictory | Both kept and flagged; neither chosen; shown side by side; neither counts as current evidence until decided | FR-027, FR-033, SC-012 |
| V11 | Feed filters | Filter the feed by each of the nine filters and combinations over 10,000 generated signals | Only matching signals, newest first, with review status, freshness and evidence status; under 2 seconds | FR-028, SC-010 |
| V12 | Unreviewed is not current | Request current evidence for an account with approved and unreviewed signals | Only approved, fresh signals counted; unreviewed labelled "pending review" | FR-029, FR-033 |
| V13 | Freshness | Record signals of different types, advance the clock past one type's window, request current evidence twice | The stale one drops out and is flagged; others per their own window; both runs identical; the stale signal is still viewable | FR-031–FR-034, SC-004 |
| V14 | Undated source | Record a signal with no published date | Flagged undated; freshness runs from the collection date | FR-034 |
| V15 | Funding context | Record a grant announcement; try to classify it as budget approval; record a cited budget-approval statement | First stays funding context and the attempt is refused; the cited statement may be budget-approval evidence; no record anywhere contains a funding-path value | FR-035, FR-036, SC-007 |
| V16 | Regulatory context-only | Record CMS-0057-F, TEFCA, RHTP and IG-change signals; try to mark HTI-5 final; re-verify one | Tagged context-only with the re-verify flag; HTI-5 final refused; re-verification clears only that flag and is recorded; external-use answer is "not without re-verification" until then | FR-037–FR-039, SC-008 |
| V17 | AI and provider limits | Ingest via the internal function as an AI actor and a provider actor; attempt `buyer_confirmed` and a reliability override | Both enter pending; the attempts refused; a trigger blocks a direct SQL attempt | FR-008, FR-009, SC-009 |
| V18 | Dead source | Mark a source unavailable | Signals kept; one provenance entry each; reliability unchanged; reviewer sees the unavailability | edge case |
| V19 | Taxonomy | Read signal types; confirm categories A–I exist including category I; confirm each signal shows its taxonomy version | Present; version recorded on every signal | FR-003, FR-004, SC-001 |
| V20 | Events and audit | Run V2, V7 and V9, inspect the outbox and audit | `signal.discovered` and `signal.reviewed` with identifiers only; every change and refusal has an audit event with no excerpt or observation text | FR-040, FR-041, SC-011 |
| V21 | Screens | Open the Signal Feed and an account's signal timeline as the reviewer | Filters work; review actions visible only to reviewers; stale, undated, pending, flagged badges and hypothesis labels visible | FR-028, FR-029 |

## 3. Tests and checks

```text
pnpm lint
pnpm typecheck
pnpm test                # unit: dedup, freshness, funding, regulatory, excerpt, validation (table-driven)
pnpm test:integration    # record, merge, review, feed, retention, audit coverage on the SQLite adapter
pnpm test:contracts      # contracts/*.openapi.yaml against the running routes
```

An end-to-end test records the fixture signals and asserts V6, V7, V10, V13 and V15. Taxonomy defaults and windows are asserted as hypotheses, not as business truth, until source §8.1 is supplied (open question #35).

## 4. Known limits (carried from ADR-015)

Runs on interim SQLite. Postgres migrations, generated columns, `pg-boss` scheduling and row-level locking are deferred; the freshness job is single-process and optional, and correctness does not depend on it.
