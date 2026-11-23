# ADR-021: Workshop lifecycle, typed findings and the reviewed buyer output

**Status**: Proposed (feature 007)  **Date**: 2026-11-23

## Context

Workshops are where the free diagnosis happens and where a buyer is most likely to hand over something they should not. The result must be honest (unknown is not negative), bounded (a free session must not drift into free consulting) and reviewed by a person before the buyer sees it. Feature 005 already owns capacity, feature 006 the request and intake, and feature 001 the PHI guard and quarantine.

## Decision

1. **The lifecycle is a pure state machine driven by people**, one open workshop per request, every move audited. A model never moves a state.
2. **A workshop's booking is a feature 005 booking, changed in the same transaction**, so capacity and state cannot drift. This needs transaction-level booking methods and fixes a lost refusal code in the existing capacity check.
3. **Findings are typed per offer and finalised by rule.** Offer 1 has exactly three classified delay sources; Offer 6 has the ten intake fields with known good, gap or unknown for five dimensions. Shortfalls are listed; only the shortfalls the spec allows (fewer sources or fields) can be waived, with a recorded reason. A finalised version never changes; a correction is a new version.
4. **Unknown is a status of its own.** No summary, view or output merges it into gap, and tests scan the templates for that.
5. **A model may only draft.** The preparation brief has a no-model baseline that is also its fallback, and a model answer is verified: an unsupported confirmed fact becomes an inference. The notes-assist returns suggestions that quote the notes, stores nothing, and cannot set a state.
6. **Uploads are text only and checked before they are kept.** A hit is held through the existing quarantine and alerts the operator; binary files are references only because their content cannot be checked.
7. **The buyer output is structured, gated and fixed as a one-page PDF.** It always has in-scope and out-of-scope sections, carries the Offer 6 disclaimer, passes the claims checker and a price check, and is approved by a person with a restricted right. Sharing is recorded and nothing is sent.
8. **A calendar is an interface with an optional Google adapter, off by default.** The adapter is given a title, a time and a length, never an attendee email, and cannot invite anyone; booking by hand always works.
9. **Files expire** 12 months after a workshop closes; metadata and the audit trail stay.

## Consequences

- One place for workshop policy; qualification (008) reads finalised findings and confirmations instead of re-deriving them.
- The boundary between free diagnosis and paid work is visible in the findings and on the page the buyer receives.
- A PDF renderer (a browser) becomes a deployment dependency, behind an interface with a fallback.
- Feature 005's booking service changes shape (compatibly), so its tests are the safety net.
