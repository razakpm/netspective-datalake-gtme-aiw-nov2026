# ADR-019: Claim and evidence governance

Status: Accepted (feature 005 plan) — assumption (hypothesis) pending project-owner confirmation (open question #48)

## Context

Public statements about Netspective's service must be backed by approved evidence or omitted (constitution V).
Feature 005 needs claims for offers now; feature 009 (content) needs them later. The runbook left open whether
claims live inside the `content` module or in their own module.

## Decision

1. **`claims` is its own module.** `offers` and `capabilities` depend on its public index; `claims` depends on
   neither. Feature 009 will depend on it too. `content` is not a home for claims because 009 depends on 005, so
   that would create a cycle.
2. **The claim checker is a pure function** in `packages/domain/src/claims`. It takes the restricted phrase list as
   data and returns class, matched text and position. It never calls a model or performs I/O.
3. **Default is omission.** Only an `approved`, unexpired claim can cover public text. A restricted claim needs
   evidence and two different designated approvers, neither the drafter. Text is covered only by an exact-sentence
   match to an approved claim.
4. **Reviews are immutable.** Approvals, rejections and false-positive dispositions are append-only, enforced by
   database triggers, so a later decision is a new record.
5. **Staleness is computed at read time.** Evidence that is withdrawn or expired makes a claim `needs_review`
   when read; an optional job materialises it.

## Consequences

- One neutral place for claim rules; offers, capabilities and content reuse it.
- The phrase list is versioned configuration with an owner and a reviewer, so changing it is itself governed.
- Customer identity in case-study text cannot be detected by words; it is handled by internal-only
  classification of delivery examples and the PHI guard, not by the checker.
