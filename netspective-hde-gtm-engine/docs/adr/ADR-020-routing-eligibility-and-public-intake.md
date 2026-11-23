# ADR-020: Routing, eligibility before AI, and the public intake boundary

Status: Accepted (feature 006 plan) — assumptions (hypotheses) pending project-owner confirmation (open question #51)

## Context

Feature 006 recommends one offer per account and opens the first public, unauthenticated entry points of the
system. Suppression, consent, ICP exclusion and capacity are legal and trust obligations (Constitution IX), and
everything a visitor sends is untrusted (Constitution XI). Feature 002, which owns suppression, contacts and ICP
fit, is only partly built.

## Decision

1. **Eligibility first, by rule.** A pure function removes options in a fixed order (ICP exclusion, suppression,
   communication permission, then per offer availability and capacity) before any rule is matched. A language
   model may only explain or order the offers that remain; its output is rejected if it names an offer outside
   the eligible set, and the deterministic order is used instead.
2. **Rules are versioned data.** The routing rule set is an immutable, schema-validated JSON document with a
   lifecycle of draft, active and retired. Activation needs a restricted permission held by a person and a
   passing run of the case corpus kept in the repository. Every recommendation records the version it used.
3. **The public group is a separate, unauthenticated boundary.** It has no session or cookies, a signed
   time-bound form token, a honeypot, a minimum submit time, rate limiting, an origin allow-list and the PHI
   guard on every value. No puzzle is used. A refusal stores and logs nothing.
4. **Consent is recorded against an approved notice version**, append-only, and is never a condition of
   receiving the register. A download is first-party engagement, never intent or a qualified lead.
5. **The feature 002 slice is built here**, in its intended modules, because routing cannot honour suppression,
   exclusion or fit without it; the remaining 002 work is unaffected.
6. **No email is sent.** The register is delivered as an expiring link on the confirmation page; sending belongs
   to feature 009.

## Consequences

- One place for routing policy; offers, content and next-best-action reuse it.
- A rule change is a reviewed diff plus a corpus change, not a deploy of code.
- The public surface is small and has its own tests; adding a form means adding a slug and a typed schema.
- The register file and the notice wording come from the business; until both exist the form says it is unavailable.

## Dependencies added

- `@fastify/cors` and `@fastify/rate-limit` (API): CORS allow-list and per-address rate limiting for the public group; both are official Fastify plugins.
- `@playwright/test` (web, development only): the browser test for Scenario C, run with `pnpm test:e2e` and kept out of the default gate.
