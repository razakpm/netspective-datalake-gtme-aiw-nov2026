# Guardrails (non-negotiable; derived from 00-source-prompt.md)

## What this system is
An internal, service-specific GTM intelligence and orchestration system for Netspective's
Healthcare Data Engineering / Data Lake service. Chain it owns:
organization → evidence → problem hypothesis → ICP fit → stakeholder → service capability →
offer → engagement → qualification → paid scope → outcome learning.

## What it is NOT
Customer-facing data lake; EHR; patient-data repository; interoperability engine; generic CRM;
marketing-automation suite; bulk email sender; lead database; generic agent platform;
PSA/delivery tool; legal/compliance advisory; certification system; autonomous SDR.

## Positioning
"Healthcare data engineering that makes complex, multi-format health data intake more reliable,
traceable, governable, and operationally usable."
Never say "AI-ready". Say "readiness for <named use case>", "traceability of selected fields",
"reliable intake across <named formats>", etc.

## Claims we must NOT make (unless an approved Claim record exists)
- Outcome metrics, SLAs, RTOs, SOC 2 status, tenant isolation, production cutover results.
- Regulatory/legal compliance or attestation.
- AI model evaluation as an established service.
- Any case-study figure or identifying combination of details (internal until client approval).
- Pricing for Sender Readiness Sprint or Input Audit (none exists).

## ICPs (initial, ordered)
1. HIE / program operator (state/regional HIE, Medicaid program operator) → Offer 1.
2. Mid-size health system with stalled data-dependent AI/analytics pilot → Offer 6.
Excluded/hold: medtech (hold), payers, multi-site practices, biotech. No silent broadening.

## Launch offers
- Offer 1 Sender Onboarding Friction Map (45-min, no PHI) → Sender Readiness Sprint (6 wks).
- Offer 6 Pilot Input Trace Workshop (90-min, 10 fields, no data leaves) → Input Audit (6–8 wks).
- Offer 5 CCDA-to-FHIR Mapping Decision Register (gated download) → routes ICP1→O1, ICP2→O6.
Offers 2,3,4,7,8,9,10 are modelled but inactive in MVP.

## SQL rules
- Offer 1: named economic buyer + funding path confirmed in session.
- Offer 6: named pilot owner + named economic buyer + identified data/AI budget owner.
- Offer 5: a download is never an SQL.

## Data boundary
Non-PHI by default. Prohibited in the GTM Engine: PHI, patient-level data, credentials.
Allowed for workshops: field names, source-system names, specs, timelines, scrubbed rejection logs.

## Human approval required for
First-time outbound campaigns; high-value personalised messages; AI-drafted replies;
claims using internal case-study evidence; messages using uncertain hypotheses;
offer/campaign/ICP policy changes.

## Deterministic only (never LLM)
Eligibility, suppression, unsubscribe, permission checks, capacity checks, PHI-boundary checks,
SQL rule evaluation.

## Hypotheses, not benchmarks
All percentages/targets (70% booked→held, 30% →scoping, 60% request→held, etc.) and offer
scores are starting hypotheses. Store them with status `hypothesis`.