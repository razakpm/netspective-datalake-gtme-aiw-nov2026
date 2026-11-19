# ADR-017: Signals are immutable observations with mutable review state

- Status: Accepted (interim), 2026-11-18
- Decided by: project owner (feature 003 plan, clarify and tasks)

## Context
Feature 003 stores signals (observations about an organisation) with full provenance. Later features
(research, qualification, intent) read them as evidence, so a signal must not be rewritten after the fact.
The runbook's plan assumed a Postgres generated column and a pg-boss nightly job for freshness, and named
the polymorphic link table `evidence_reference`, which feature 002 already uses.

## Decision
- A signal's observation, excerpt, account, type, taxonomy version, source and dates never change after
  insert (database trigger). Only review state, flags, reliability (by a reviewer, with a reason) and
  retention change. Merges and decisions append to a provenance chain and a review table (both append-only).
- Freshness is stored as `fresh_until` and "current evidence" is computed at read time (approved, within its
  window, not purged). An optional daily job only materialises a stale flag, so correctness never depends on
  a scheduler. Retention is also applied lazily at read time, with an optional job.
- Account scoping resolves `merged_into` when reading, because `account_id` is immutable.
- The link table is `signal_link` (supporting or contradictory). Funding is `context` unless a cited budget
  approval exists; no column expresses a funding path.
- Events are `signal.discovered` and `signal.reviewed`; `signal.normalized` is not emitted.

## Consequences
- No generated column and no scheduler dependency until the Postgres adapter lands (ADR-015).
- A re-observation is a new signal or a merge, never an edit.
- The worker queues `signals.freshness` and `signals.retention` are not registered in this version; the
  service methods `markStale` and `applyRetention` exist and are tested (open question #39).
