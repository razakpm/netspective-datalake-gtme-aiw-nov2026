# Research: Signals and Evidence

Decisions for Feature 003. Format: Decision / Rationale / Alternatives. Numeric values are **hypotheses**, configurable and labelled as such (constitution XVIII). No `NEEDS CLARIFICATION` remains; items needing human confirmation are at the end.

## R-01 Module, persistence and naming

- **Decision**: One new module `signals` in `apps/api` with a public `index.ts`; pure rules in `packages/domain/src/signals`; interim SQLite behind `Tx` (ADR-015) with migrations `0011`–`0013`. The runbook's polymorphic link table `evidence_reference` is named **`signal_link`**, because `evidence_reference` already exists from feature 002 (a minimal record of a fact and its status). 002's table is left unchanged; a 002 evidence reference can be linked to a signal through `signal_link` (`entity_type = 'evidence_reference'`), and nothing in 002's rules (including the economic-buyer confirmation) changes (FR-042).
- **Rationale**: Same architecture as 001 and 002, no new infrastructure, no naming collision.
- **Alternatives**: Rename 002's table (breaks shipped migrations and tests); merge both concepts into one table now (forces 002 to be redesigned before 004 exists).

## R-02 Signal record: immutable facts, mutable state

- **Decision**: A signal row has two parts. **Immutable after insert** (enforced by an `UPDATE` trigger): account, contact link, type and taxonomy version, source and source reference, normalised observation, excerpt and its withheld reason, observed/collected/published dates, extraction method, content fingerprint. **Mutable state**: review status, evidence-status-visible flags (`new_provenance_flag`, `reverify_required`), freshness materialisation, `reliability` (reviewer override with a recorded reason), and retention markers. Everything that changes is recorded in the append-only provenance chain or the review table. A retention purge is the only path that may blank observation/excerpt (trigger exception when `purged_at` is set).
- **Rationale**: "Evidence you can re-check" requires that what was observed cannot be edited later (spec edge case: later changes at the source do not rewrite the stored signal).
- **Alternatives**: Versioned rows per edit (more storage and joins for no benefit); freely editable observation (loses provenance).

## R-03 Normalisation, fingerprint and de-duplication

- **Decision**: Normalise the observation (Unicode NFKC, trim, collapse whitespace; max 1,000 characters) and compute `content_fingerprint = SHA-256(account_id | type_key | lower-cased text with punctuation removed)`. Canonicalise the source reference (lower-case host, strip fragment and common tracking parameters, trailing slash; identifiers such as notice numbers upper-cased and trimmed) into `source_ref_normalised`, and an optional `item_key` (for example a notice number). `decideDuplicate` (pure) returns, in order:
  1. **identical**: same account, type, fingerprint **and** same source and source reference → no write at all, response says it already exists (FR-021);
  2. **merge as republication**: same account, type and fingerprint from a *different* source, or the same non-null `item_key` → one signal, second source recorded in the provenance chain (FR-023);
  3. **merge as duplicate**: same account, type and source with text similarity ≥ threshold (default 0.85, hypothesis) → merge (FR-020);
  4. otherwise a **new** signal.
  Text similarity reuses the character-trigram Sørensen–Dice approach from organisation matching, applied to normalised text (no generic-word stripping).
- **Merge effect**: no new signal; a provenance entry is appended; the original observed date, observation and excerpt are kept; if the signal was already approved it stays approved and gets `new_provenance_flag = 1` until a reviewer clears it (FR-024). Independent-source counting counts distinct **signals**, never provenance entries, so a republication never counts twice (FR-023, SC-003).
- **Rationale**: Deterministic, explainable, idempotent; conservative (cross-source merging only on identical content or an explicit shared item key, never on similarity alone).
- **Alternatives**: Semantic embeddings (non-deterministic, forbidden for rule decisions); merging cross-source on similarity (risks fusing distinct notices).

## R-04 Provenance chain

- **Decision**: `signal_provenance` is append-only with a sequence per signal and a kind: `first_recorded`, `merged_duplicate`, `republication`, `reviewed`, `reverified`, `flag_cleared`, `source_unavailable`, `retention`. Each entry holds actor, actor type, method, source and source reference where relevant, and time. Entries carry codes and ids only, never free text; reasons live in the guarded review table.
- **Rationale**: Gives one place to read "how we know this" (User Story 2) without storing content twice.

## R-05 Review model and contradictions

- **Decision**: `signal_review` is append-only with decisions `approve`, `reject` (reason required), `contradict` (names the other signal), `reverify` (regulatory flag) and `clear_flag` (merge flag). The signal's `review_status` is `pending`, `approved`, `rejected` or `contradictory` and is updated in the same transaction as the review row. Marking a pair contradictory creates a `signal_contradiction` row and sets **both** signals to `contradictory` (neither is preferred, even at equal reliability, FR-027); a later approve or reject on either signal changes only that signal, and the contradiction is marked resolved when neither remains `contradictory`. A changed mind is a new review row. Contradiction does not change the evidence status or the observation. Only `signals.review` holders (technical SME reviewer, administrator, human only) may decide, and they may decide their own signals (clarified).
- **Alternatives**: A third status that overrides reliability (hides the conflict); automatic resolution by reliability (forbidden: a person decides).

## R-06 Freshness and current evidence

- **Decision**: Each signal stores `freshness_days` (copied from its type at record time, so a later taxonomy version never changes it) and `fresh_until = anchor + freshness_days`. The **anchor** is the published date; if unknown, the collected date and the signal is flagged `undated`; for first-party types (category I) the observed date, because those events have no publication (FR-034). `isStale(signal, now)` and `isCurrentEvidence(signal, now)` are pure; **current evidence** = `review_status = 'approved'` AND `now < fresh_until` AND not purged. `is_current` is **computed at read time** (SQLite generated columns cannot depend on the clock and the runbook's pg-boss cron is deferred). A scheduled job `signals.freshness` (daily, recurring-schedule support from 001) only materialises `freshness_state = 'stale'` for filtering and writes a `signal.stale` audit entry once per signal; correctness never depends on the job having run.
- **Rationale**: Deterministic and repeatable for identical inputs and date; no stale signal can be served as current even if the job is late.
- **Alternatives**: Relying on the job (stale data between runs); storing `is_current` (can be wrong).

## R-07 Funding signals

- **Decision**: Funding types (category E, kind `funding`) carry `funding_class` of `context` (default) or `budget_approval_evidence`. `classifyFunding` allows `budget_approval_evidence` only for the type `budget_approval_statement`, and only when a cited approval statement is supplied (`approval_citation`, guarded text); a `grant_announcement` or `procurement_notice` can never be classified as budget approval. No table or column in the feature can express "funding path confirmed"; a schema test scans all column names for `funding_path`. Confirmation stays a qualification decision (feature 008) needing buyer confirmation.
- **Alternatives**: A boolean `funding_confirmed` on signals (invites the exact mistake the spec forbids).

## R-08 Regulatory signals

- **Decision**: Types of kind `regulatory` are always `context_only = 1` with `reverify_required = 1` at insert. `regulatory_status` is `proposed`, `unverified` or `reported_final` (final *as reported by the source*). A configurable never-final list (initially `HTI-5`) refuses `reported_final` for any signal whose `regulatory_item` or observation matches (case-insensitive, with or without the hyphen). Only a `reverify` review (recorded with reason) clears `reverify_required`; the external-use check answers "not without re-verification" until then. No field states compliance or non-compliance.
- **Rationale**: Matches guardrails (no regulatory/legal compliance claims) and FR-037 to FR-039.

## R-09 Excerpts and source storage rules

- **Decision**: `effectiveExcerptLimit = min(global limit, source.excerpt_max_chars if set)`; a source with `storage_rule = 'citation_only'` has limit 0. An excerpt over the limit, or any excerpt from a citation-only source, is not stored: the signal keeps citation and observation and records `excerpt_withheld_reason` of `too_long` or `source_no_storage`. The global default is 300 characters (hypothesis). A source entered **inline** by a recorder who has no source-management permission is created `citation_only` until an administrator allows excerpts, so recording can never loosen a storage rule. A source marked unavailable (dead URL) keeps all signals, records a `source_unavailable` provenance entry per signal once, and does not change reliability silently.
- **Alternatives**: Truncating long excerpts (stores text the source may not permit); trusting recorders to set storage rules.

## R-10 PHI guard and text fields

- **Decision**: Every text field (observation, excerpt, source name and reference, notes, approval citation, review reasons) passes the 001 PHI guard before anything is stored, logged or echoed. The HTTP layer already guards JSON bodies; the service re-guards each field because provider and AI ingest bypass HTTP. A refusal returns 422 with rule IDs only and an audit event; nothing is stored. Redaction is not attempted: the whole signal is refused.

## R-11 Actors and provider/AI ingest

- **Decision**: `POST /v1/signals` is for people. Providers and AI components (feature 004) call the internal `ingestSignal(actor, submission)` which runs the same validation. Actor limits, enforced in the service and by a trigger: `ai` and `system` actors cannot set `evidence_status = buyer_confirmed`, cannot override reliability, and always enter as `pending`; `extraction_method` must be `provider` or `ai_extracted`, and `ai_extracted` requires model and prompt version. A `SignalSubmission` Zod schema in `packages/ai-contracts` defines the ingest payload.
- **Rationale**: Constitution II and VIII; one validation path, as the spec requires.

## R-12 Permissions

- **Decision** (hypotheses, open question #38 for the rest): `signals.read` — gtm_operator, research_analyst, technical_sme_reviewer, sales_service_lead, read_only_executive, administrator; `signals.record` — gtm_operator, research_analyst, administrator; `signals.review` — technical_sme_reviewer, administrator (restricted, humans only, clarified); `signals.sources.manage` — administrator (restricted). Refusals are audited. The `contacts.read` permission is required to see a linked contact.

## R-13 Events and audit

- **Decision**: Outbox events with identifiers only: `signal.discovered` (new or merged; payload `signal_id`, `account_id`, `type_key`, `merged`), and `signal.reviewed` (`signal_id`, `decision`, `review_status`). The runbook's `signal.normalized` is **not** emitted in this feature because normalisation is part of recording; the name is reserved for feature 004's AI normalisation. Audit events for every state change and refusal; summaries hold ids and field names only, never excerpt or observation text.

## R-14 Taxonomy and seeding

- **Decision**: `taxonomy_version` (current/retired) and `signal_type` rows per version, seeded as version 1 with the hypothesis types from the spec (A–I, including category I types now). A signal stores the version it was recorded under. Adding a version is a seed/migration change for now (no edit API); retired types stay readable but cannot be used for new signals. Per-type defaults: freshness days, default reliability, `kind` (`general`, `funding`, `regulatory`, `first_party`), `context_only`.
- **Rationale**: Source §8.1 is not in the repository (open question #35); the seed marks every default `hypothesis` so replacing it later is a data change.

## R-15 Relationship to feature 002

- **Decision**: The ICP evaluator keeps reading 002's `evidence_reference` until feature 004 wires current signal evidence into assessments. `signal_link` provides the supporting/contradictory links; a helper `linkEvidenceReference(signalId, evidenceReferenceId)` exists for the bridge. Signals are not read by any 002 rule in this feature. After an account merge (002), signals follow the surviving account by reading through `account.merged_into`; the original account id stays in the signal row for history. After contact erasure, the signal's `contact_id` is set to null by the erasure routine's hook; the account-level observation remains.

## R-16 Numeric defaults (hypotheses, configurable)

| Item | Default |
|------|---------|
| Similarity threshold (same account/type/source) | 0.85 Sørensen–Dice on character trigrams |
| Global excerpt limit | 300 characters; source may only tighten |
| Observation maximum | 1,000 characters |
| Retention | 36 months for signals, citation kept as long as the account (`SIGNAL_RETENTION_MONTHS`) |
| Freshness windows (days) | A 365, B 180, C 180, D 365, E 120, F 90, G 180, H 365, I 90 |
| Future-date tolerance | observed date may not be more than 1 day in the future |
| Never-final regulatory items | HTI-5 |
| Feed page size | default 50, maximum 200 |

## R-17 UI

- **Decision**: A Signal Feed page at `/signals` (all nine filters, pagination, review actions for reviewers, hypothesis labels, stale/undated/unreviewed/flag badges) and a reusable `SignalTimeline` component for the account detail screen. Both follow the 001 session policy and permission gating. Contradictory pairs are shown side by side.

## Items for human confirmation

1. Inline sources entered by recorders are `citation_only` until an administrator allows excerpts (R-09).
2. Freshness anchor: published date, else collected date (observed date for first-party types) (R-06).
3. `signal.normalized` replaced by `signal.reviewed` for this feature (R-13).
4. Cross-source merging only on identical content or an explicit shared item key, never on similarity alone (R-03).
5. Taxonomy types and windows are hypotheses until source §8.1 is supplied (open questions #35, #36).
