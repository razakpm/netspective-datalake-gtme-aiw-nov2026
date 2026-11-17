# Quickstart: Accounts, Contacts, Stakeholders and ICP Fit

A run-and-validate guide. It contains no implementation code. Details live in [contracts/](contracts/), [data-model.md](data-model.md) and [research.md](research.md). All data is synthetic (`tests/fixtures/synthetic-orgs/`); no real prospect data is used anywhere.

## Prerequisites

- Feature 001 running locally (interim SQLite per ADR-015), branch `002-accounts-contacts-icp` checked out.
- A seeded administrator (`pnpm admin:bootstrap --email admin@example.org`) and a seeded `gtm_operator` and `sales_service_lead` from the synthetic seed.
- `SUPPRESSION_HASH_KEY` set in `.env` (placeholder value in `.env.example`; never commit a real key).
- Applied migrations `0007`–`0010` (`pnpm db:migrate`).

## 1. Load the synthetic data

The fixture set is created as the first task of this feature: ten synthetic organisations and one synthetic contact, as CSV plus a manifest of expected outcomes.

```text
tests/fixtures/synthetic-orgs/
├── organisations.csv        # all organisation fixtures (incl. aliases, domains, types)
├── contacts.csv             # synthetic contacts incl. pat.unsubscribed@example.org
├── evidence.json            # evidence references used by the assessment fixtures
└── expected.json            # expected outcomes (only the four named in FR-026 are fixed)
```

Import them through the API or the account list screen (section 2, V1–V2).

## 2. Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|----------|------------|------------------|------|
| V1 | Organisation import report | Upload `organisations.csv` (plus a copy with two bad rows) to `POST /v1/accounts/import?dry_run=true`, then without `dry_run` | Dry run saves nothing; report lists every row with outcome and reason; real run creates valid rows only; poll `GET /v1/import-runs/{id}` | FR-001–FR-003, SC-004 |
| V2 | Idempotent re-import | Re-upload the identical file | Every row `unchanged`; no record or audit change; counts identical | FR-007, SC-002 |
| V3 | Duplicate flagged, never merged | Import a row sharing a domain (or a similar name with the same type) with an existing account | Row `flagged`; a `merge_candidate` review item appears; existing account untouched | FR-004, FR-005, SC-003 |
| V4 | Shared domain | Mark a domain shared, import a second account on it | No candidate raised for the shared domain alone | FR-008 |
| V5 | Merge review | Decide a candidate in the review queue with a reason and field choices | Accounts combined; all names/domains/contacts/notes kept; absorbed account marked merged; audit event; rejected pair not re-proposed | FR-005, FR-006, SC-012 |
| V6 | PHI-like row | Import a row containing a synthetic SSN pattern in notes | Row `rejected` with `phi_guard:<rule_id>`; content not stored, logged or echoed; other rows processed | FR-018, FR-050 |
| V7 | Contact import rules | Import contacts missing source, with a personal mailbox email, and for an unknown account | Each rejected with its reason; valid rows created and linked | FR-012–FR-014, SC-005 |
| V8 | Contact conflict | Re-import a person with a different title | Row `conflict`; review item queued; stored record unchanged until accepted | FR-015 |
| V9 | ICP outcomes | `POST /v1/icp-fit-assessments` for each fixture account | `helixbio` excluded; `northvale-hie` strong ICP1; `riverbend-health` strong or possible ICP2; `summitcare-health` possible ICP2 with "no demonstrated data problem" unmet; every result shows met/unmet, evidence, confidence, definition version | FR-019–FR-026, SC-001, SC-008 |
| V10 | Determinism and history | Assess the same account twice | Identical results (same `inputsHash`); two history rows; no intent field present | FR-021, FR-024, FR-025 |
| V11 | Exclusion and override | As `gtm_operator` try to override `helixbio`; then as administrator grant with rationale, then revoke | First refused and audited; grant makes it eligible with original exclusion still shown; revoke returns to not eligible as a new version; missing rationale rejected | FR-027–FR-029, SC-007 |
| V12 | Economic buyer needs evidence | Set confirmed role `economic_buyer` with no linked evidence, then with a `buyer_confirmed` evidence reference | First 422 and nothing saved; second succeeds with evidence shown and audited; an inferred role never reads as confirmed | FR-033, FR-034, SC-006 |
| V13 | ICP definition versions | Admin edits ICP 2, activates; re-fetch earlier assessments | Edit creates an inactive draft; activation is a separate step; earlier assessments keep their version; non-admin refused; invalid definition rejected | FR-036–FR-039, SC-010 |
| V14 | Suppression | Any user suppresses `pat.unsubscribed@example.org` and, separately, a whole account; check `GET /v1/contacts/{id}/eligibility`; re-import and merge | "suppressed" immediately with scope and reason; stays after re-import and merge; follows the person across accounts; non-admin lift refused, admin lift recorded with both entries in history | FR-041–FR-045, SC-009 |
| V15 | Erasure | Administrator erases a contact | Personal fields gone; marker keeps keyed hash only; re-import of that email is blocked | FR-049 |
| V16 | Contact leaves | End a relationship with date and reason | History kept; not shown as active stakeholder; suppression unchanged | FR-016 |
| V17 | Events | Run V1, V7 and V9 and inspect the outbox | `account.created`, `contact.identified`, `icp.fit_assessed` present with identifiers only, no names or emails | FR-048 |
| V18 | Audit and classification | Run the audit-coverage and classification tests | Every state change and refusal has an audit event; every new column is classified | FR-046, SC-011 |
| V19 | Operator screens | Open account list, account detail, contact list and review queue as `gtm_operator` | Screens render the data above; fit panel shows the AI suggestion (when present) labelled advisory; hypothesis labels visible on definitions and thresholds | FR-020, FR-022 |

## 3. Tests and checks

```text
pnpm lint
pnpm typecheck
pnpm test                # unit: evaluator table tests over all fixtures, similarity, CSV, roles, suppression
pnpm test:integration    # import jobs, merge, override, suppression across the SQLite adapter
pnpm test:contracts      # contracts/*.openapi.yaml against the running routes
```

The end-to-end integration test imports every fixture and asserts the ICP outcomes in V9. Outcomes for fixtures other than the four named in FR-026 are asserted only for determinism and structural invariants until the GTM lead supplies expected values (open question #28).

## 4. Known limits (carried from ADR-015)

Runs on interim SQLite. Postgres migrations, `pg_trgm` prefiltering and row-level locking are deferred; the import worker is single-process.
