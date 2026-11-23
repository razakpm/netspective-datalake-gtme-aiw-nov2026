# Research: Offer Routing and Lead Magnet

Decisions taken in planning. Numeric and structural defaults are **hypotheses** unless stated, and are tracked in open question #51. Every decision lists what was weighed.

## R-01 Modules and the engagement to offers cycle

**Decision**: Work lands in three existing modules: `offers` (routing rules, recommendations, wait-list), `engagement` (public forms, consent, notice versions, requests, downloads) and `workshops` (typed intake records only). Two small modules from feature 002 are filled in as well (R-02): `contacts` and `icp`.

`offers` reads `engagement` for prior interactions; `engagement` must trigger a recommendation after a download. To keep the dependency one-way, `engagement` calls a `Recommender` **port** that the composition root fills with the offers service (the same pattern as `AccountService.setHooks`). `engagement` imports `workshops`, `accounts`, `contacts`, `icp` and `claims` only through their `index.ts`.

**Rationale**: Constitution XVI (public indexes, events for the rest) and no cycle between the two modules that need each other.

**Alternatives**: engagement publishes an event and offers subscribes (rejected: the outbox is for outward notices, and the download must show its follow-up in the same request for the operator queue test); one merged module (rejected: public input handling has a different threat model and release cadence).

## R-02 The feature 002 slice this feature needs

**Finding**: feature 002 is only partly built. Accounts import and duplicate review (US1) are done. The tables for contacts, suppression and ICP assessment exist (migrations 0008 to 0010) and the personal-domain list is seeded, but there is **no code** for contact creation, the suppression check, ICP definitions or the fit evaluator, and the `contacts` and `icp` modules are empty stubs.

**Decision**: build only the slice that 006 needs, as the first tasks of 006, and record in 002's tasks which of its tasks are thereby covered (the 004 approach to feature 001). The slice is:
- the pure suppression primitives and the single eligibility check (002 FR-044) over `suppression_record` (contact, account and keyed-hash scopes), plus `addSuppression` so the check is testable;
- contact validation and find-or-create by business email, with the source recorded (002 US2, only the first-party path; CSV import stays in 002);
- the ICP types, the two default definitions (status `hypothesis`, bed band unset), the pure evaluator and a minimal assessment service writing `icp_fit_assessment` (002 US3), and the pure `priorityEligibility` rule (002 US4: `weak`, `unknown` and `excluded` are not priority-eligible).

Everything else in 002 (imports, relationships and roles, overrides, erasure, screens) stays in 002 and is not blocked by this.

**Rationale**: 006 cannot honour suppression, ICP exclusion or "ICP fit" without them, and inventing a private substitute would fork the rules. Building the real functions once, in their intended modules, means 002 later extends them.

**Alternatives**: finish all of 002 first (rejected: delays this feature by about sixty tasks that 006 does not need); stub the three behind fakes (rejected: Scenario C must run on real rules).

## R-03 The routing engine

**Decision**: `evaluate(context, ruleSet)` is a pure function in `packages/domain/src/routing/`. It returns the eligible offers with a reason for each, the excluded offers with a code, the matched rules in precedence order, the chosen outcome, whether outreach is allowed and why not, and the limitations. It performs no I/O and never calls a model.

The rule set is **data**: a versioned JSON document validated by a Zod schema. A rule has an id, a priority (lower wins), conditions and a result:
- conditions: `trigger` (`operator` or `offer5_download`), `icp` (`icp1` or `icp2`), a supported hypothesis in given categories, a supported hypothesis with a capability tag, and a minimum number of distinct supported categories among tagged hypotheses;
- result: an offer key or an outcome (`research`, `no_action`), plus a reason template.

Rule set v1 (hypothesis), in priority order:

| Priority | Id | When | Result |
|---|---|---|---|
| 10 | `icp1-onboarding-friction` | ICP 1 and a supported hypothesis in `onboarding_friction` or `ig_change_management` | Offer 1 |
| 10 | `icp2-pilot-input` | ICP 2 and a supported hypothesis in `pilot_input_quality` | Offer 6 |
| 20 | `offer5-download-icp1` | trigger `offer5_download` and ICP 1 | Offer 1 follow-up |
| 20 | `offer5-download-icp2` | trigger `offer5_download` and ICP 2 | Offer 6 follow-up |
| 30 | `multi-format-gap` | at least two distinct categories among supported hypotheses tagged capability `multi_format_intake` | Offer 1 for ICP 1, Offer 6 for ICP 2 |
| 40 | `ccda-fhir-decisions` | either ICP and a supported hypothesis tagged capability `ccda_to_fhir_mapping` | Offer 5 |
| 90 | `no-supported-hypothesis` | none of the above | research when fit is possible or strong, no action when fit is weak or excluded |

When ICP fit is unknown the fallback is research. A supported hypothesis is evaluated by R-05. Several matching rules are all listed; the lowest priority number wins, and ties are broken by rule id. A recommendation of an offer other than 1, 5 or 6 is possible if a later rule set names one (outcome `other_offer`); v1 has none.

**Rationale**: Constitution IX and the description ("versioned, configurable, unit-tested"). Data rules let a new version be reviewed as a diff and recorded on each recommendation.

**Alternatives**: rules as code (rejected: not versionable by non-engineers, and a change would need a deploy); a general rules language (rejected: more expressive than needed); an LLM to choose the offer (forbidden, Constitution IX).

## R-04 Eligibility order and the outcome model

**Decision**: before any rule is matched, eligibility removes options in a fixed order, each recorded with a code:
1. `account_excluded` or `fit_not_priority`: ICP fit excluded (or weak or unknown for outreach, by the 002 `priorityEligibility` rule);
2. `contact_suppressed`: the contact, the account or the keyed email hash is suppressed (the 002 check, by rule);
3. `no_communication_permission`: a contact is given and the latest `consent_record` for the contact or keyed email hash is missing or has `consent_given = 0`. In v1 there is no other basis: a contact imported without a consent record is blocked, and the limitation says "no recorded consent". A wider permitted-use basis belongs to feature 009 (open question #51);
4. per offer: `offer_unavailable` (not in force, withdrawn, expired or draft) and `capacity_exhausted` (the 005 `capacityStatus` says exhausted).

A recommendation has an **outcome** (`offer`, `research`, `no_action`) and an **outreach** flag (`allowed` or `blocked` with the reasons). Account-level blockers (1) and contact-level blockers (2, 3) set outreach to blocked and, when they leave no offer to suggest, the outcome to `no_action` with the reason; an offer-level blocker only removes that offer. `no_limit_set` capacity does not remove an offer and adds a limitation.

**Rationale**: FR-004; the order puts the strongest legal and trust obligations first, and each code is testable.

**Alternatives**: scoring and thresholds (rejected: not explainable); consent checked only at send time (rejected: spec FR-021 wants it visible at recommendation).

## R-05 What counts as a supported hypothesis

**Decision**: a pure function `isSupported(hypothesis, evidence, config)` in `packages/domain/src/routing/`, per spec FR-012: accepted; effective status not rejected, weakening or stale; and either status strengthening or validated, or untested with at least one current approved supporting signal and a confidence band of `SUPPORTED_MIN_BAND` (default `medium`) or higher. It reads the effective status and evidence view that feature 004 already computes (no new evidence logic). Every other accepted hypothesis is weak.

**Alternatives**: any accepted hypothesis counts (rejected: a rejected or stale hypothesis would route); only validated (rejected: almost nothing would route early).

## R-06 The AI contract: explain and rank, never decide

**Decision**: a new structured contract `offer-recommendation-explain@1.0.0` in `packages/ai-contracts` with prompt `offer-explain`. Input is a typed allow-list: the eligible offer ids and keys, the matched rule ids, the ICP fit status, hypothesis categories and supported flags, the capacity state and the limitations. It contains **no external text**: no page text, signal observation, contact name or email. Output: `ranking` (a permutation of the eligible ids only), `explanation` (at most 600 characters) and `limitations` (at most five short strings). The service rejects any output whose ranking has an id outside the eligible set, a duplicate or a missing one, then falls back to the deterministic order and a template explanation, and records that it fell back.

The call goes through the existing LLM gateway (PHI pre-flight, budget, schema validation, one `ai_invocation` row, no text stored). The gateway's `ModelInput` allow-list gains one key, `recommendation`. The `ai_invocation` task is `synthesis` and the context type `other`: both are already allowed by the table's constraint, so **no table rebuild** is needed. The AI step is controlled by `RECOMMENDATION_AI` (default `off`, a hypothesis); with it off the explanation is the deterministic template and nothing is sent anywhere.

**Rationale**: Constitution IX and X; spec FR-004. Keeping external text out of the input removes the injection surface for this call.

**Alternatives**: let the model pick the offer (forbidden); a new `ai_invocation` task value (rejected: forces recreating an append-only table for no gain); AI on by default (rejected: no provider decision for production yet, open question 11).

## R-07 Rule set versions, activation and the test gate

**Decision**: `routing_rule_set` rows are immutable once inserted; the lifecycle is `draft` to `active` to `retired`, at most one active (a partial unique index), the same shape as 002's ICP definitions. Activation needs `routing.rules.manage` (service lead or administrator, a restricted permission, humans only), a reason, and **a passing test run**: the service evaluates the candidate against the case corpus, which ships inside the package as `packages/domain/src/routing/corpus.json` (so it is present in a deployed container; `tests/fixtures/routing/cases.json` re-exports it for the tests) (each case lists a context, the expected outcome and eligible set, and a flag `mustHold` for the rules the business has fixed) and refuses activation if a case fails or the document fails its schema. Rule changes that intentionally change outcomes are made by changing the corpus in the same pull request, which is reviewed.

**Rationale**: FR-009 and FR-013; the gate is real, not a convention.

**Alternatives**: activation without a test run (rejected by FR-013); storing tests in the database (rejected: tests belong in the repository and review).

## R-08 Public endpoints and abuse protection

**Decision**: a separate, unauthenticated route group under `/api/v1/public/` with its own error shape, no cookies and no session. Per form slug it exposes `GET /offers/{slug}/form` (the approved notice, the fields, a form token), `POST /offers/{slug}/requests` and `GET /downloads/{token}`.
- **Slugs** reuse the offer keys from feature 005: `ccda-to-fhir-mapping-decision-register` (kinds `download` and `working_session`), `sender-onboarding-friction-map` (kind `intake`) and `pilot-input-trace-workshop` (kind `intake`). Any other slug is a 404.
- **Form token**: an HMAC over the slug and issue time, signed with a configured key. A submission needs a token that is valid, at least `FORM_MIN_SECONDS` old (default 3) and at most `FORM_MAX_AGE_HOURS` old (default 24). A hidden honeypot field must be empty. Failing either is rejected with a generic message and counted. No puzzle is shown or solved.
- **Rate limiting** with the official Fastify rate-limit plugin, per client address, in memory (one instance, ADR-015), with a lower limit on `POST`. **CORS** with the official CORS plugin and an allow-list from `PUBLIC_FORM_ORIGINS`; an empty list means no cross-origin calls. Body size and field lengths are capped.
- **PHI guard** on every free-text value; a refusal is whole, stores nothing and notifies the operator (spec FR-028).
- **Dedupe**: the same email hash, slug and kind within `PUBLIC_DEDUPE_SECONDS` (default 60) returns the first result and creates nothing new.

**Rationale**: FR-029; the official plugins are small, maintained and avoid hand-written security code. The token needs no server state, so there is no new table.

**Alternatives**: hand-rolled rate limiting and CORS (rejected: easy to get wrong); a CAPTCHA (rejected by the description); a stored single-use nonce (rejected for now: a table and cleanup for little extra protection).

## R-09 Consent and notice versions

**Decision**: `notice_version` rows hold the privacy notice text and the consent wording, with an author, an approver and an approval time; only an approved version is served by the form endpoint, and a version cannot be edited once approved (a new row is a new version). The marketing approver approves (`notices.approve`, restricted). Each download or request writes an append-only `consent_record` holding the version shown, the choice and the time, tied to the request and, once known, to the contact. Withdrawing consent is a new row with `consent_given = 0`; the current permission is the latest row for the person.

**Rationale**: FR-017 and the clarified wording owner. The latest-row rule matches how suppression and ICP definitions work.

**Alternatives**: a consent flag on the contact (rejected: no history, no wording).

## R-10 Register delivery and file storage

**Decision**: add the minimal slice of feature 001's storage provider: interface `FileStorageProvider` (`get(key)` returning a readable stream or null, `signedUrl(key, expiresAt)`), a local-disk adapter and a fake. The local adapter signs `key|expiry` with an HMAC key (`DOWNLOAD_SIGNING_KEY`); `GET /api/v1/public/downloads/{token}` verifies the signature and expiry and streams the file. The register is stored under the key in `REGISTER_FILE_KEY` in the directory `FILE_STORAGE_DIR`; the file is supplied by the business and is **not in the repository**, so when it is missing the form still records the download as a failed delivery and says so plainly (spec edge case). The link lifetime is `REGISTER_LINK_TTL_HOURS` (default 24). A fresh link is a new submission, which creates a new download record.

**Rationale**: spec FR-020 and the clarification (link on the confirmation page, no email). A signed link needs no table and no email.

**Alternatives**: a stored token per download (rejected: state and cleanup for the same result); public static file (rejected: gating would mean nothing).

## R-11 Resolving the account and contact from a form

**Decision**: a download or request is resolved in this order, all in one transaction with the request record:
1. a personal email domain (the configurable list seeded by feature 002) means: no account and no contact are created; the request is stored, flagged `personal_email`, and the keyed email hash is still checked against suppression;
2. otherwise the email's domain is normalised and matched to an existing account (a domain marked shared never matches by domain alone); a match reuses the account and flags a difference in organisation type for review; no match creates an account with source `first_party_form`;
3. the contact is found by business email or created with source `first_party_form`; the role given is recorded as the title.
Organisation type comes from a fixed select that maps to the types in feature 002. The ICP fit assessment is then run (R-02) and the recommendation made with trigger `offer5_download` for downloads.

**Rationale**: spec FR-018, FR-019, FR-022 and the 002 rule that contacts are business contacts.

**Alternatives**: create a contact even for personal email (rejected by spec FR-019).

## R-12 Intake forms and the field-names-only rule

**Decision**: intake records are typed per offer with Zod schemas in `packages/domain/src/workshops/`, versioned (`schema_version`). Free text has a length limit and every value goes through the PHI guard. The Offer 1 schema has no field for credentials, production data or budget. The Offer 6 schema needs exactly ten `fieldNames`, each checked by a pure function `looksLikeFieldName` that refuses an entry that reads as a value: longer than 60 characters, containing `@`, containing a run of six or more digits, matching a date or time shape, containing more than five words, or ending in a sentence mark. A fixture corpus (`tests/fixtures/intake/field-names.json`) holds accepted names (including `DOB`, `patient_id`, `encounter_date`) and refused values; the rule is a hypothesis tuned against it. Patient-like patterns are caught by the PHI guard regardless.

**Rationale**: spec FR-026 and the acceptance criterion; two layers (shape and the guard) so a value that is not patient-shaped is still refused.

**Alternatives**: accept any text and rely on the guard (rejected: a non-PHI value such as a name still breaks the field-names-only rule); a model to judge (forbidden).

## R-13 The request inbox and review

**Decision**: `offer_request` has a review state `received`, `reviewed`, `linked` or `closed`. Operators with `requests.read` list and open requests; with `requests.review` they link a request to an account and contact (needed for a flagged personal-email request, which also creates the business contact if they confirm one), mark it reviewed or close it with a reason. Intake submissions and consent records show on the request detail. Nothing in the inbox sends anything.

## R-14 Recommendations: persistence, staleness and review

**Decision**: a recommendation is stored append-only (its review state aside). It stores an **inputs hash** over the facts it used (fit assessment id, hypothesis ids and effective statuses, suppression and consent state, capacity answers, offer availability), the rule set version, the eligible and excluded sets with codes, the matched rules, the outcome and outreach, the explanation, the limitations and, when used, the ranking and the `ai_invocation` id. Out of date is **computed at read** by recomputing the hash. Acceptance and dismissal are written to separate review columns with who, when and why; acceptance re-checks capacity and eligibility and is refused if the offer has just become full or the contact suppressed.

## R-15 Wait-list

**Decision**: `offer_waitlist_entry` rows record an offer, account, contact and reason, who added them and when, with a state `waiting`, `released` or `removed`. The list is shown oldest first; releasing or removing is an operator action with a reason. Nothing is sent.

## R-16 Permissions and roles

**Decision** (hypothesis, open question #51): new permissions `offers.recommend` (request, accept and dismiss recommendations), `requests.read`, `requests.review`, `waitlist.edit`, `routing.rules.manage` (restricted), `notices.manage` and `notices.approve` (restricted). Mapping: `gtm_operator` gets `offers.recommend`, `requests.read`, `requests.review` and `waitlist.edit`; `research_analyst` gets `requests.read`; `sales_service_lead` gets all of the operator's plus `routing.rules.manage`; `campaign_approver` gets `notices.manage` and `notices.approve`; administrator gets everything. Reading recommendations uses the existing `offers.read`. Public endpoints need no permission.

## R-17 Screens and the end-to-end test

**Decision**: a **recommendation panel** is added to the account workspace (`workspace-view.tsx`): the latest recommendation with its outcome, outreach state, explanation, limitations, rule set version, an out-of-date marker, accept and dismiss controls, a "recommend again" control and the alternatives and wait-list option when an offer is full. A **request inbox** page at `/requests`. The **hosted public pages** are at `/public/offers/[slug]` in the web app, and a small unauthenticated proxy `/api/public/[...path]` forwards only to `/api/v1/public/*` (the existing `/api/v1` proxy needs a session and stays as it is). Playwright is **not** in the repository: it is added as a dev dependency with an `e2e` script and a test for Scenario C that drives the hosted page against the API with the fake providers and an in-memory database. The browser download is heavy, so e2e is not part of the default `pnpm test` gate; the same scenario also runs as an HTTP-level integration test that is always on.

**Alternatives**: no browser test (rejected by the description); e2e in the default gate (rejected: slows every run and needs browsers in CI).

## R-18 Configuration

**Decision** (all hypotheses): `PUBLIC_FORM_ORIGINS` (comma list, default empty), `PUBLIC_RATE_LIMIT_PER_MINUTE` (default 20 for `POST`, 120 for `GET`), `FORM_MIN_SECONDS` (3), `FORM_MAX_AGE_HOURS` (24), `PUBLIC_DEDUPE_SECONDS` (60), `REGISTER_LINK_TTL_HOURS` (24), `REGISTER_FILE_KEY`, `FILE_STORAGE_DIR`, `DOWNLOAD_SIGNING_KEY` and `FORM_TOKEN_KEY` (secrets, required in production, scrubbed from logs), `RECOMMENDATION_AI` (`off`), `SUPPORTED_MIN_BAND` (`medium`).

## R-19 Migrations and data classification

**Decision**: forward-only migrations `0020_routing.sql`, `0021_engagement.sql` and `0022_intake.sql`. Append-only tables get refusal triggers. Every column is registered in `COLUMN_CLASSIFICATION`: requester email, name and role as `business_contact`; intake text and explanations as `confidential_commercial`; identifiers and timestamps as `sensitive_operational_metadata`. Events carry identifiers only.

## R-20 Events

**Decision**: `offer.recommended` (recommendation id, account id, outcome, rule set version), `offer.requested` (request id, kind, offer id) and `lead_magnet.downloaded` (download id, request id, delivered). Strict schemas; no email, name, text or link ever appears. A refused or deduplicated submission emits nothing.
