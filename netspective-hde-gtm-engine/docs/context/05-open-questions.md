| # | Unknown | Why it matters | Recommended default | Decider | Blocks MVP? |
|---|---|---|---|---|---|
| 1 | Confirmation of the two ICPs before any expansion | Targeting policy | Treat as final; expansion via versioned override | GTM lead | No |
| 2 | Definition of "mid-size" health system | ICP2 rule | Configurable thresholds; start with analyst judgement + "possible" status | GTM lead | No |
| 3 | Buyer Review's five interview questions (not in source) | Workshop and experiment scripts | Placeholder field "Buyer Review question set — input required"; never invented | GTM lead | Yes for 012 experiment script |
| 4 | Budget sources | Funding path | Store as hypothesis only | Sales lead | No |
| 5 | Case-study public-use approval and anonymisation level | Claims/content | All case-study details restricted | Client + marketing approver | No (blocks publishing only) |
| 6 | Offer 6 monthly capacity number | Routing | 3 sessions/month | Delivery lead | No |
| 7 | Offer 1 weekly capacity number | Routing | 3 sessions/week during validation | Delivery lead | No |
| 8 | Identity provider (Google vs Microsoft) | Auth | OIDC, configurable | IT admin | Yes for 001 deploy |
| 9 | Email provider and sending domain | 009 | Postmark or SES; dedicated subdomain with SPF/DKIM/DMARC | Marketing ops | Yes for 009 |
| 10 | Email compliance jurisdictions | Consent rules | US CAN-SPAM baseline; consent-required mode for EU/UK/Canada contacts | Legal counsel | Yes for 009 |
| 11 | LLM provider and data-sharing policy | 004+ | Anthropic Claude API, zero-retention settings where available; no restricted/internal case-study content sent without policy approval | CTO | Yes for 004 |
| 12 | Approved research sources | 004 | Manual URL capture + public procurement portals + org websites; no scraping against ToS | GTM lead | No |
| 13 | Contact enrichment provider | 002/004 | None in MVP; manual import only | GTM lead | No |
| 14 | Calendar provider | 007 | Manual booking + external booking link; Google/Microsoft adapter later | GTM ops | No |
| 15 | CRM in use, if any | 012 | No sync in MVP; export CSV | Sales lead | No |
| 16 | Hosting/cloud target | Deployment | Containers on one managed platform; decide by ADR before production | CTO | Yes for production |
| 17 | Data retention periods | Privacy | Signals 24 months, contacts until suppression/deletion request, audit 7 years, AI invocation logs 12 months | Privacy lead | No |
| 18 | Public form hosting (site embed vs hosted page) | 006 | Minimal hosted page + embeddable endpoint | Marketing | No |
| 19 | Regulatory timing notes (CMS-0057-F, TEFCA, RHTP) | Content accuracy | Context-only; re-verify before any external use; HTI-5 never treated as final | Content SME | No |
| 20 | Pricing for paid engagements | Scoping | None stored; human scoping only | Service lead | No |
| 21 | Designated claim approvers | 005/009 | Service lead + marketing approver (two-person for restricted claims) | Leadership | Yes for 009 |
| 22 | Resilience Review scope | Offer 8 | Inactive until defined | Service lead | No |
| 23 | PHI guard default action (reject vs quarantine) | 001 | Reject by default; quarantine only at entry points explicitly configured for review. **Resolved 2026-11-12** (recommended default accepted in clarify session) | Privacy lead (to confirm) | No |
| 24 | Retention periods beyond #17: webhook raw body/headers, quarantine, job payload/error details, API idempotency records | 001 | Webhook raw 90 days (metadata kept); quarantine 30 days max; job details 90 days after terminal state; idempotency records 24 hours — **assumption (hypotheses)** | Privacy lead | No |
| 25 | Encryption of transport and storage | 001 | TLS everywhere; encryption at rest for database, file storage and quarantine; production start-up refuses non-TLS database and non-https URLs — **assumption** pending hosting decision (#16) | CTO | Yes for production |
| 26 | Session lifetimes and API idempotency key expiry | 001 | Session 8 h absolute / 30 min idle; idempotency keys 24 h — **assumption (hypotheses)**, configurable | IT admin / Security | No |
| 27 | Foundation role-to-permission matrix | 001 | administrator all; gtm_operator jobs.read + webhooks.read; read_only_executive audit.read + jobs.read + ai_invocations.read; others none — **assumption (hypothesis), accepted as a starting point 2026-11-12** | GTM lead | No |
| 28 | Initial ICP 1 and ICP 2 criteria wording and the meaning of strong / possible / weak / unknown | 002 | Hypotheses in 002 spec Assumptions (type match + evidence criteria; strong needs all required criteria on observed or buyer-confirmed evidence) — **assumption (hypothesis)** | GTM lead | No |
| 29 | Allowed contact sources and permitted-use basis values | 002 | Manual import with documented origin, first-party form, public directory/website, referral, customer-supplied list; bases: B2B legitimate interest, consent, existing relationship, service-related — **assumption** | Legal counsel / Privacy lead | No |
| 30 | Suppression scope beyond contact and account (for example whole email domain) | 002 | Contact and account scopes only; no domain-level suppression because of shared domains — **assumption** | Privacy lead | No |
| 31 | Duplicate-matching thresholds (name/alias similarity) and shared-domain handling | 002 | Exact normalised domain proposes a candidate unless marked shared; similarity threshold configurable, starting conservative — **assumption (hypothesis)** | GTM lead | No |
| 32 | Feature 002 role-to-permission mapping | 002 | Operators import/edit; sales/service leads edit stakeholder roles; administrators alone lift suppressions, override exclusions and manage ICP definitions; any signed-in user may add a suppression — **assumption (hypothesis)** | GTM lead | No |
| 33 | Feature 002 plan decisions: drop `communication_preference` from 002 (consent belongs to 009); keyed HMAC for the erasure marker; `weak`/`unknown` fit not priority-eligible; expected ICP outcomes for the six fixtures not named in the spec; bed band values pending | 002 | **Confirmed 2026-11-16 by project owner:** drop `communication_preference`; `weak`/`unknown` not priority-eligible; only determinism and structure asserted for the six unnamed fixtures; bed band stays unset (analyst-judgement route only). **Still to confirm:** keyed HMAC for the erasure marker (research R-09) | GTM lead / Privacy lead | No |
| 34 | Feature 002 first-version shortcuts to revisit: ordered first-match fit status table (spec Assumptions / research R-06); assessment `basis` for excluded/unknown; list configuration by seed/config change only (no edit UI/API); `/evidence` path documented in the contacts contract but implemented in the accounts module; SC-004/SC-012 usability targets checked manually; imports run synchronously in the request rather than as queued jobs | 002 | Minimal first version chosen 2026-11-16 to ship quickly — **assumption (hypothesis)**, revisit after first release | GTM lead / project owner | No |
