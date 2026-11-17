# Research: Accounts, Contacts, Stakeholders and ICP Fit

Decisions for Feature 002. Format: Decision / Rationale / Alternatives. Numeric values are **hypotheses**, configurable, and shown with a hypothesis label (constitution XVIII). No `NEEDS CLARIFICATION` remains; items needing human confirmation are listed at the end.

## R-01 Persistence and similarity (replaces `pg_trgm`)

- **Decision**: Build on the interim SQLite adapter (ADR-015). Name/alias similarity is a pure function in `packages/domain/accounts/similarity.ts`: lower-case, strip punctuation and legal/organisational stop-words (`inc`, `llc`, `health`, `system(s)`, `the`…), pad, split into character trigrams, score with Sørensen–Dice. Default threshold 0.80 (hypothesis, conservative), configurable. Candidate generation compares a new/changed account only against accounts with the same organisation type **or** geography (spec FR-004), so work is O(n·k), fine for low-thousands scale.
- **Rationale**: SQLite has no trigram index and Postgres is deferred. A pure function is deterministic, unit-testable and identical on both stores. A later Postgres adapter may use `pg_trgm` only as a prefilter; the domain function stays the authority so results do not drift.
- **Alternatives**: SQLite FTS5 trigram tokenizer (not portable, harder to test); Levenshtein (poor on word-order changes); embeddings (non-deterministic, forbidden for rule decisions).

## R-02 Module layout and cross-module access

- **Decision**: Fill `apps/api/src/modules/accounts` and `icp`, add `contacts`. Each exposes only `index.ts`. Cross-module needs: `contacts` and later features call `isContactSuppressed(tx, contactId)` and `priorityEligibility(tx, accountId)` from public indexes; the assessment service in `icp` reads accounts through `accounts/index.ts`. Events carry identifiers only.
- **Rationale**: Matches 001 and the boundary lint (ADR-001). The two eligibility answers are the "single rule-based answer" FR-030/FR-044 require.
- **Alternatives**: Shared DB views read by later modules (breaks boundaries); a separate eligibility service (new deployable, rejected by principle XVI).

## R-03 Import as an idempotent job with per-row isolation

- **Decision**: `POST /v1/accounts/import` and `POST /v1/contacts/import` accept `text/csv`, require an `Idempotency-Key` header (001 mechanism for HTTP retries), create an `import_run` and enqueue a job (`accounts.import` / `contacts.import`, key = import run id). Optional `?dry_run=true` validates the whole file synchronously and returns the report without saving (satisfies "report before anything is saved"). The worker validates the whole file first, then applies each valid row in its own transaction, so a rejected row leaves no partial data and valid rows are kept (FR-003). Job re-delivery is safe because each row's outcome is keyed `(import_run_id, row_number)` and applying a row is a no-op when the stored record already equals the normalised row.
- **Idempotent re-import (FR-007)**: matching uses stable identifiers (normalised domain + alias for accounts; business email for contacts). A row whose normalised values equal the stored record reports `unchanged` and writes nothing, including no audit event and no timestamps. Distinct runs are separate `import_run` rows (a re-import is a new run that reports all `unchanged`).
- **Report**: `import_row` stores `row_number`, `outcome` (`created|updated|unchanged|rejected|flagged|conflict`), reason codes, matched entity id. It stores **no row content**, so a PHI-like row leaves only its row number and guard rule IDs.
- **Alternatives**: single transaction for the whole file (one bad row blocks valid ones, contradicts FR-003); synchronous import in the request (fails the "idempotent job" requirement and blocks on large files).

## R-04 CSV parsing and limits

- **Decision**: Own RFC 4180 parser in `packages/domain/csv/parse.ts` (quoted fields, escaped quotes, CRLF/LF, UTF-8 with optional BOM). Whole-file rejects: wrong/missing required headers, non-UTF-8, over 5 MB or 5,000 rows (hypotheses), unterminated quote. Unknown extra columns are rejected (no silent ignore) so a typo like `domian` is visible. Cells are trimmed; empty optional cells allowed.
- **Rationale**: Pure, dependency-free, fuzz/property-testable, no supply-chain surface for an input format that is attacker-influenced.
- **Alternatives**: `csv-parse`/`papaparse` (extra dependency, more behaviour to pin down in tests).

## R-05 CSV and content safety

- **Decision**: Cell values are data only. PHI guard (001) runs over every cell before storage; a trigger rejects the row. Values beginning with `= + - @` are stored as-is but prefixed with `'` on any CSV export (none is built here; rule recorded for later). Domains are validated as hostnames (no scheme/path); profile URLs must be `https`.
- **Alternatives**: strip such characters on import (alters data, breaks idempotency).

## R-06 ICP definition format and evaluator

- **Decision**: `icp_definition` stores a versioned JSON rule set validated by a Zod schema: `{ icp: "icp1"|"icp2", criteria: [{ id, label, required, kind, test }], status_rules }`. `kind` is one of `account_type_in`, `account_attr_in_band` (used for staffed bed count), `evidence_present` (an evidence criterion keyed by the evidence reference `topic`), `analyst_judgement`. `status_rules` is an ordered, table-driven mapping, first match wins (first version, to revisit with the GTM lead): (1) excluded type → `excluded`; (2) type `unknown`, or type matches but there is no evidence and no size/judgement recorded → `unknown` with the missing items listed; (3) known, non-excluded type that the ICP does not target → `weak`; (4) type matches and all required criteria met on `observed`/`buyer_confirmed` evidence → `strong`; (5) type matches otherwise → `possible`. Check against fixtures: `summitcare-health` (health system with only generic AI interest) → `possible`; `northvale-hie` ICP 1 → `strong`; `helixbio` → `excluded`. `evaluate(accountSnapshot, evidenceRefs, definition)` is pure and returns met/unmet criteria (each with evidence ids and a contradictory-evidence list), status, confidence, definition version.
- **Confidence** (hypothesis from spec): `high` when met criteria rest on `observed`/`buyer_confirmed` evidence, `medium` when partly inferred, `low` when mostly assumed.
- **Initial definitions** (status `hypothesis`, in `defaults.ts`): ICP 1 = type in {HIE, state/Medicaid program operator} (required) + sender onboarding / IG change friction evidence (required). ICP 2 = type health system (required) + bed count in configurable band or analyst judgement (required, judgement caps at `possible`) + stalled data-dependent AI/analytics pilot evidence (required) + "demonstrated data problem" evidence (required). Band values left unset until the GTM lead supplies them (open question #2); until then only the analyst-judgement path applies.
- **Fixtures**: expected outcomes asserted only for the four named in FR-026. For the other six fixtures the table-driven test asserts structural invariants (deterministic, never `strong` without evidence, excluded types excluded) and leaves `expected_status: "pending-gtm-lead"` — outcomes are not invented here.
- **Alternatives**: free-form scoring (not explainable); JSON-logic library (adds a dependency and a more expressive language than needed); LLM judgement (forbidden).

## R-07 Versioning, overrides, assessment history

- **Decision**: All three are append-only with an explicit state, enforced by SQLite triggers like 001's audit/job tables:
  - `icp_definition`: `(icp, version)` unique; edits insert a new `draft` row; activation is a separate admin action that retires the previous `active` version in the same transaction (at most one `active` per ICP, partial unique index). Retired/draft rows never change content.
  - `exclusion_override`: each grant or revoke inserts a row (`action: grant|revoke`, rationale required); current state = latest row per account.
  - `icp_fit_assessment`: insert-only; a re-assessment adds a row. An assessment started under version N completes under N (version read once at start).
- **Eligibility** (`eligibility.ts`): priority-eligible when the status for at least one ICP is `strong` or `possible`; `weak` and `unknown` are not eligible; `excluded` is not eligible unless the latest `exclusion_override` row for the account is an active `grant`. Pure, unit-tested, never AI. The override is shown beside the original exclusion and never replaces it. (The `weak`/`unknown` treatment is a hypothesis to confirm with the GTM lead.)
- **Alternatives**: updating assessments in place (violates FR-025/FR-038).

## R-08 Permissions

- **Decision**: Add permissions, mapped to roles per the open-question #32 hypothesis, with the foundation matrix kept as the base:
  - `accounts.read`, `contacts.read`: gtm_operator, research_analyst, sales_service_lead, technical_sme_reviewer, read_only_executive, administrator
  - `accounts.import`, `accounts.edit`, `contacts.import`, `contacts.edit`, `review.decide`: gtm_operator, administrator
  - `stakeholders.edit`, `evidence.record`: sales_service_lead, gtm_operator, administrator
  - `icp.read`: all roles with `accounts.read`
  - `icp.assess`: gtm_operator, research_analyst, administrator
  - `icp.manage`, `icp.override`, `suppressions.lift`, `contacts.erase`: administrator only (restricted permissions; humans only)
  - Adding a suppression requires only an authenticated, active user (no role permission), as the spec requires.
- Authorisation continues to be loaded from the database on every request; refusals are audited (001 behaviour).
- **Alternatives**: coarse `accounts.write` (cannot separate import from stakeholder edits).

## R-09 Suppression and erasure

- **Decision**: `suppression_record` (insert-only; lifting adds a `lift` row) with scope `contact` or `account`. `isContactSuppressed(tx, contactId)` returns suppressed when (a) any active contact-scope record exists for the person, (b) any active account-scope record exists for **any** account the person has an active relationship with, or (c) a matching erasure marker exists. Computed in the same transaction as the caller; no cache (SC-009). Because the check is by person, it follows them across accounts, merges and re-imports.
- **Erasure (FR-049)**: administrator action deletes name, title, email, profile URL, notes and relationships' personal fields, and writes a suppression record keyed by `HMAC-SHA256(SUPPRESSION_HASH_KEY, lower(trim(email)))`. A keyed hash is used because plain SHA-256 of an email is trivially reversible by guessing; the key is an environment secret (001 secrets rule). Imports hash the incoming email and are blocked on a match. The audit event for erasure contains the contact id and hash prefix only.
- **Alternatives**: plain hash (guessable); keep plaintext email (retains personal data).

## R-10 Entity resolution and the shared review queue

- **Decision**: Candidate rules in `resolve.ts`: (a) normalised-domain exact match, unless the domain is flagged `shared`, always yields a candidate; (b) name/alias similarity ≥ threshold yields a candidate **only if** organisation type or geography also matches (clarified 2026-11-16); (c) shared-domain match alone never yields one. Candidates and contact conflicts both become `review_item` rows (`kind: merge_candidate|contact_conflict`) for one queue screen. Rejecting a candidate stores a `pair_key` (sorted ids); re-proposal is suppressed until a matching attribute (domain, alias, type, geography) changes — detected by comparing a stored `attribute_fingerprint`.
- **Merge**: human decision with reason; the surviving account keeps every name (as alias), domain, contact relationship and note from both; conflicting scalar fields (type, geography, bed count) require the reviewer to choose; the absorbed account row is marked `merged_into` (never deleted) so references and audit stay valid. Suppression moves with the people because it is keyed by person/account scope, and account-scope suppression on either account carries to the survivor.
- **Alternatives**: automatic merge above a high threshold (forbidden, FR-005); deleting the absorbed account (breaks history).

## R-11 Stakeholder roles, relationships and evidence references

- **Decision**: `stakeholder_role` is a seeded reference table of the 20 fixed roles. `account_contact_relationship` holds `title_stated`, `role_inferred`, `role_confirmed`, `authority_status` (`unconfirmed|confirmed`), `started_at`, `ended_at`, `end_reason`. Confirming `economic_buyer` calls a domain function that fails unless ≥1 linked `evidence_reference` with status `buyer_confirmed` exists; a database trigger repeats the check so no code path can bypass it. `evidence_reference` is the minimal record from the spec (what, where, when, who recorded, status from the constitution's evidence-status enum); feature 003 extends it. "Is a buyer confirmed here" reads only `role_confirmed`/`authority_status`.
- **Alternatives**: single role column with a flag (blurs inferred vs confirmed); free-text evidence (not checkable).

## R-12 Scope decisions on the runbook's table list

- **Decision**: `communication_preference` is **not** built: the spec defers consent/preference management to feature 009 and covers do-not-contact via suppression. `contact_source` is built as a history table (source value, basis value, documented origin, recorded by/at) so source/basis changes are audited and viewable (FR-017). `account_classification` is the append-only history of organisation type and staffed bed count with who/when (FR-040a), separate from the account's identity row. Controlled lists (org types, sources, bases, personal mailbox domains) are code constants seeded to configuration tables so they are configurable (FR-013).
- **Flag for confirmation**: runbook lists `communication_preference`; dropping it needs the user's nod in review.

## R-13 Events, audit, classification

- **Decision**: Events `account.created`, `contact.identified`, `icp.fit_assessed` through the outbox (payload: ids, org type/status, definition version — no contact names or emails). Every state change and every refused action writes an audit event in the same transaction. New columns are classified: contact name/email/profile URL/title as `business_contact`; org data and assessments as `confidential_commercial`; ids, timestamps and states as `sensitive_operational_metadata`. Audit `before/after` summaries carry field names and ids, not contact personal values.

## R-14 AI suggestion

- **Decision**: `packages/ai-contracts` gains `IcpFitSuggestion` (status, rationale ≤ N chars, evidence ids, confidence band, model/prompt version, review status). Stored in `icp_fit_ai_suggestion`, linked to an assessment but never merged into it; the UI shows it under an "AI-generated, advisory" label. No code in this feature calls a model; generation arrives with feature 004. A contract test proves the stored rule status is unaffected when a suggestion differs.

## R-15 UI

- **Decision**: Four operator screens in the existing Next.js app, reusing 001 session policy and nav: account list (filter by type/fit/eligibility, import button with dry-run preview and per-row report), account detail (profile, aliases/domains, classification history, ICP fit panel with met/unmet/evidence/confidence/version and override state, contacts and roles, suppression controls), contact list, review queue (side-by-side candidate/conflict view with approve/reject + required reason). Hypothesis labels are rendered where definitions and thresholds appear.

## R-16 Numeric defaults (hypotheses, configurable)

| Item | Default |
|------|---------|
| Similarity threshold | 0.80 Sørensen–Dice on trigrams |
| Max import file | 5 MB, 5,000 rows |
| Staffed bed band | unset until GTM lead supplies (open question #2) |
| Personal mailbox domains | seeded list of common consumer providers, editable |
| Contact sources | manual import with documented origin; first-party form; public directory/website; referral; customer-supplied list |
| Permitted-use bases | B2B legitimate interest; consent; existing relationship; service-related |

## Items for human confirmation

Confirmed by the project owner on 2026-11-16: (1) `communication_preference` dropped from this feature (R-12); (3) `weak` and `unknown` fit are not priority-eligible (R-07); (4) expected outcomes for the six unnamed fixtures are not invented, only determinism and structure are asserted (R-06); (5) bed-count band stays unset until the GTM lead supplies values, so only the analyst-judgement route applies to ICP 2 (open question #2).

Still open:

1. Keyed HMAC instead of a plain hash for the erasure marker (R-09); proceeds as planned unless the privacy lead objects.
2. Bed-count band values, ICP criteria wording (open questions #1, #2, #28) and the role-to-permission mapping (#32), all hypotheses.
