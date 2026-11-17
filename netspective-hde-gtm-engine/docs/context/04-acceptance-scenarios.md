# Canonical acceptance scenarios and synthetic fixtures

All data is synthetic. Never use real organisation or person names.

## Synthetic organisations (tests/fixtures/synthetic-orgs/)
1. `northvale-hie` — strong-fit regional HIE, repeated sender onboarding delays.
2. `prairie-medicaid-ops` — Medicaid program operator, IG release/change-management issue.
3. `riverbend-health` — mid-size health system, stalled AI pilot, ten traceability questions.
4. `summitcare-health` — health system with generic AI interest, no demonstrated data problem.
5. `helixbio` — biotech (excluded ICP) — must not be prioritised.
6. `lakeshore-hie` — conflicting public evidence.
7. `metro-health-partners` — confirmed problem, no economic buyer.
8. `coastal-hie` — strong problem + confirmed funding path.
9. Contact `pat.unsubscribed@example.org` — unsubscribed; must never receive messages.
10. `granite-health` — attempts to upload an apparent PHI artifact; must be rejected/quarantined.

## Scenario A — ICP 1 (Offer 1)
Import HIE → discover evidence of multi-format senders + updated IG (with URLs/dates) → ICP1 fit
→ onboarding-friction hypothesis (observed vs inferred separated) → identify interop/data-ops
stakeholder → recommend Offer 1 with explanation → operator approves outreach → prospect
books Friction Map → intake non-PHI only → findings: 3 delay sources + who can fix each
(operator/sender/rule owner) → record delay+owner confirmation → economic buyer identified or not
→ funding path confirmed/hypothesised/unknown → recommend Sender Readiness Sprint scoping
ONLY if SQL rule met, else defer/do nothing → outcome + analytics recorded.

## Scenario B — ICP 2 (Offer 6)
Import health system → buyer statement "pilot worked on demo data, failed on ours" recorded as
buyer_confirmed → capture use case, source-system names, 10 field names (no values) → ICP2 fit +
hypothesis → recommend Offer 6 → operator approves → workshop traces 10 fields across quality,
completeness, freshness, provenance, access (unknown ≠ negative) → bounded go/no-go with unknowns
→ draft Input Audit scope (1 use case, 1–2 sources) → record pilot owner / economic buyer /
budget owner → scoping, defer or no action → outcome.

## Scenario C — Offer 5 lead magnet
Download with work email, role, org type + notice/consent → resolve/create account → ICP fit →
log as first-party engagement (not intent proof) → route ICP1→Offer1, ICP2→Offer6 with
explanation → enforce permissions/unsubscribe → measure download→session separately.

## Scenario D — PHI boundary
Upload/intake containing PHI-like patterns (MRN, DOB+name, SSN, patient rows) → blocked or
quarantined, never sent to LLM, never logged in clear, operator notified, audit event.

## Scenario E — Claims governance
Draft content containing "AI-ready", an SLA, SOC 2, a case-study figure → flagged → cannot be
approved without approved Claim+evidence → default removal suggested.

## Scenario F — Suppression
Unsubscribed contact in a campaign → excluded deterministically, regardless of AI recommendation.

## Scenario G — Capacity
Offer 6 capacity reached for the month → Offer 6 not recommended; alternative (wait-list, Offer 5,
research, do nothing) with explanation.