# ADR-016: In-code similarity, keyed erasure marker, no communication preferences in feature 002

- Status: Accepted (interim), 2026-11-17
- Decided by: project owner (plan confirmations 2026-11-16)

## Context
Feature 002 (accounts, contacts, ICP) runs on the interim SQLite adapter (ADR-015). The runbook's plan
named `pg_trgm` for name similarity and a `communication_preference` table.

## Decision
- Name and alias similarity is a pure trigram Sørensen–Dice function in `packages/domain`, default
  threshold 0.80 (hypothesis). A Postgres `pg_trgm` prefilter may be added later; the domain function
  stays the authority so results do not drift.
- Erasing a contact keeps only a suppression marker holding an HMAC-SHA256 of the lower-cased business
  email, keyed by `SUPPRESSION_HASH_KEY`. A plain hash would be guessable.
- `communication_preference` is not built: consent and preference management belong to feature 009.
  Suppression covers do-not-contact here.

## Consequences
- Similarity runs in application code, so candidate generation is limited to accounts with the same type or
  geography (fine for low-thousands scale).
- Rotating `SUPPRESSION_HASH_KEY` invalidates existing erasure markers; rotation needs a re-hash procedure
  (not built; open question #34).
- Retire the interim parts when the Postgres adapter lands (see ADR-015).
