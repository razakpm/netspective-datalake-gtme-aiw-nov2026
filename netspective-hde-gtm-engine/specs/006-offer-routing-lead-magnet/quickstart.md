# Quickstart: Offer Routing and Lead Magnet

A run-and-validate guide. It contains no implementation code. Details live in [contracts/](contracts/), [data-model.md](data-model.md) and [research.md](research.md).

## Prerequisites

- Features 001 to 005 running locally (interim SQLite, ADR-015), branch `006-offer-routing-lead-magnet`, migrations `0020`–`0022` applied.
- Seeded users: a GTM operator (`gtm_operator`), a service lead (`sales_service_lead`), a marketing approver (`campaign_approver`) and an administrator.
- Seed applied: routing rule set version 1 (active). Synthetic organisations from `tests/fixtures/synthetic-orgs/` imported, with their hypotheses and signals.
- A synthetic register file in the file store under the configured key, and one **approved** notice version (the form is unavailable until one exists).

## Validation scenarios

| # | Scenario | How to run | Expected outcome | Spec |
|---|----------|------------|------------------|------|
| V1 | ICP 1 recommendation | Recommend for `northvale-hie` (supported onboarding-friction hypothesis) | Offer 1, matched rule `icp1-onboarding-friction`, explanation, limitations, rule set version 1 | FR-001, FR-003, SC-001 |
| V2 | ICP 2 recommendation | Recommend for `riverbend-health` | Offer 6, rule `icp2-pilot-input` | FR-010 |
| V3 | Offer 5 | Recommend for an account with a supported hypothesis tagged `ccda_to_fhir_mapping` and no stronger match | Offer 5, rule `ccda-fhir-decisions` | FR-010 |
| V4 | Multi-format gap | Account with supported hypotheses in two categories tagged `multi_format_intake` | Offer 1 for ICP 1, Offer 6 for ICP 2 | FR-010 |
| V5 | Weak hypothesis | Recommend for `summitcare-health` (generic AI interest) and for an account whose hypothesis is stale or rejected | Research or no action, no automatic email proposed | FR-005 |
| V6 | Excluded ICP | Recommend for `helixbio` | No action, outreach blocked `account_excluded` | FR-004, SC-002 |
| V7 | Suppression | Recommend for `pat.unsubscribed@example.org` | Outreach blocked `contact_suppressed`; no model output changes it | FR-004, SC-002 |
| V8 | No permission | Contact without consent or a permitted-use basis | Outreach blocked `no_communication_permission` | FR-004, FR-021 |
| V9 | Precedence and ties | Account matching several rules | All matched rules listed, chosen by priority then rule id, reason given | FR-011 |
| V10 | Determinism | Recommend twice with the same inputs and version | Identical eligible set and matched rules | FR-006, SC-006 |
| V11 | Out of date | Reject a supporting signal after a recommendation | The recommendation reads out of date; a new one reflects the change; the old one is unchanged | FR-008 |
| V12 | Accept and dismiss | Accept one; dismiss another without and with a reason | Accept sends nothing; dismissal needs a reason; both audited | FR-007 |
| V13 | AI step is bounded | Turn `RECOMMENDATION_AI` on with the fake model; make it rank an offer outside the eligible set | The output is rejected, the deterministic order and template explanation are used, `ai_fallback` is set | FR-004 |
| V14 | Rule set versions | Create a draft, activate with a failing corpus case, then fix and activate | Refused `rules_tests_failed`, then active; the earlier version stays readable; recommendations record the version | FR-009, FR-013, SC-008 |
| V15 | Capacity exhausted | Fill Offer 6 for the month; recommend for an ICP 2 account | Offer 6 not recommended; alternatives wait-list, Offer 5, research, do nothing with reasons | FR-014, Scenario G |
| V16 | No limit set | Offer with no capacity limit | Not treated as unlimited; the limitation is stated | FR-014 |
| V17 | Wait-list | Add an account and contact to Offer 6's wait-list; view it; release one | Oldest first; nothing sent; closing needs a reason | FR-015 |
| V18 | Form and token | `GET` the form; submit without the token, with the honeypot filled, and immediately after issue | Each refused with a plain message, no records created | FR-029 |
| V19 | Notice unavailable | Request the form with no approved notice version | 503 with a plain message | FR-017 |
| V20 | Download (Scenario C) | Submit a work email, role, org type, notice and consent for a synthetic ICP 1 organisation | Account and contact created, consent record with the notice version, download recorded as engagement, link on the confirmation page, a follow-up recommendation for Offer 1 waiting in the inbox, nothing sent | FR-016 to FR-018, SC-003 |
| V21 | ICP 2 download | Same for an ICP 2 organisation | Follow-up for Offer 6 | FR-010 |
| V22 | Not intent | Inspect the download | Labelled first-party engagement; not an intent or qualified-lead record | FR-018 |
| V23 | No consent | Download without agreeing to be contacted | Register delivered, download recorded, no outreach recommended and the reason shown | FR-021 |
| V24 | Personal email | Download with a free consumer address | Accepted and delivered, flagged `personal_email`, no account or contact created, suppression hash still checked | FR-019, SC-004 |
| V25 | Suppressed downloader | Download by a suppressed contact | Register delivered, recorded, no follow-up ever recommended | FR-021 |
| V26 | Repeat and double submit | Submit twice within a minute; submit again later | One set of records for the double submit; a later submit reuses the account and contact and makes a new download | FR-022 |
| V27 | Link expiry and failure | Open the link after it expires; remove the register file and submit | The link gives 410 and a fresh link is a new download; a missing file is a recorded failed delivery with a plain message | FR-020 |
| V28 | Working session | Submit a session request with five decisions; then six, one over-long, and one with patient-like text | The first is queued, separate from any download; the others refused | FR-024 |
| V29 | Offer 1 intake | Submit a clean intake; one missing a required item; one with a credential or patient-like value | Clean one stored non-PHI; the others refused whole | FR-025, FR-027 |
| V30 | Offer 6 intake | Submit ten field names; nine; eleven; a sample value (a date of birth, a name with a number); a sentence | Ten accepted; the rest refused; sample patient values blocked by the guard, nothing stored or logged, operator notified | FR-026, FR-028, SC-005 |
| V31 | Abuse | Send 25 submissions in a minute from one address; call from a site not on the allow-list | Throttled with a plain message; the cross-origin call is refused | FR-029 |
| V32 | Inbox | Open the inbox; review, link and close requests; link a personal-email request with a business email | States change with who and when; a business contact is created only from a supplied business email | FR-030 |
| V33 | RBAC | Call each operator route as a role without the permission | 403 and an audited refusal | FR-031 |
| V34 | Audit and events | Recommend, accept, receive a download | One audit record each; events carry identifiers only and never an email, name, text or link | FR-032, FR-033 |
| V35 | Scenarios C and G | Run the cross-feature test over the fixtures; run `pnpm test:e2e` for the browser version of C | Scenario C: download, account, fit, engagement, routed follow-up queued; Scenario G: Offer 6 full reads exhausted with alternatives | Scenarios C, G |

## Run

```bash
cd netspective-hde-gtm-engine
pnpm test                 # routing corpus, supported hypothesis, intake rules, signing and expiry
pnpm test:integration     # recommendations, public group, consent, delivery, RBAC, audit, events
pnpm test:contracts       # public, routing and engagement contracts
pnpm test:e2e             # Playwright, Scenario C (run on request)
pnpm lint && pnpm typecheck && pnpm format
```

All numeric defaults, the rule set, the supported-hypothesis thresholds and the role mapping are hypotheses (open question #51).
