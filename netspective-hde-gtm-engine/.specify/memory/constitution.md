# Netspective Healthcare Data Engineering GTM Engine Constitution

This constitution governs an internal, service-specific GTM intelligence and orchestration system
for Netspective's Healthcare Data Engineering / Data Lake service. It is not a customer-facing
product, EHR, CRM, bulk email sender or autonomous SDR (see `docs/context/01-guardrails.md`).

Keywords MUST, MUST NOT, SHOULD and SHOULD NOT carry their RFC 2119 meaning. Every principle
states a rationale and a "Checked by" line; a rule with no check is not yet enforceable and MUST
be given one before the feature that depends on it merges.

## Core Principles

### I. Evidence Before Inference
Every material conclusion (ICP fit, hypothesis, offer recommendation, qualification, next best
action) MUST link to supporting evidence records AND any contradictory evidence records.
Conclusions without evidence references MUST NOT be persisted.

- **Rationale**: GTM decisions made on unsupported inference waste buyer attention and damage
  credibility.
- **Checked by**: schema validation (non-empty evidence refs; contradictory refs field present)
  and unit/contract tests rejecting conclusions without evidence.

### II. Buyer-Confirmed Facts Are Distinct From Assumptions
Every fact MUST carry exactly one evidence status: `observed`, `buyer_confirmed`,
`derived_interpretation`, `ai_hypothesis`, `unverified_assumption` or `contradictory`.
Repetition, restatement or summarisation by an AI agent MUST NOT upgrade a status. Economic
buyer, funding path and decision authority MUST NOT be inferred from title or seniority.

- **Rationale**: SQL rules depend on confirmed buyer facts; blurred status inflates the pipeline.
- **Checked by**: status enum in the domain schema; tests that AI-originated writes cannot set
  `buyer_confirmed`; tests that title/seniority never populate buyer or funding fields.

### III. Provenance For Everything
Every signal MUST record source, URL or identifier, dates (observed, collected, published),
extraction method, model and prompt version (when AI-extracted), reliability and retention
policy. Only short excerpts permitted by the source's terms MAY be stored.

- **Rationale**: Claims about an account must be traceable, re-verifiable and expirable.
- **Checked by**: required-field schema on the Signal entity; tests rejecting signals missing
  provenance; excerpt-length limit enforced in validation.

### IV. Non-PHI By Default
PHI, patient-level data and credentials are prohibited data classifications. The prohibition
MUST be enforced in the UI, API validation, storage, logging, LLM prompts and retention jobs.
Suspected PHI MUST be blocked or quarantined, never sent to an LLM, never logged in clear, and
MUST raise an audit event and operator notification.

- **Rationale**: The engine has no legitimate need for PHI; any exposure is a severe incident.
- **Checked by**: deterministic PHI-boundary checks at each layer; Scenario D; log-redaction
  tests; prompt-assembly tests proving quarantined content cannot reach an LLM.

### V. No Unsupported Claims
Outcome metrics, SLAs, RTOs, SOC 2 status, tenant isolation, production results,
legal/regulatory compliance, AI-evaluation-as-a-service, pricing, and case-study details MUST NOT
appear in any output or content without an approved Claim with linked evidence. The phrase
"AI-ready" MUST NOT be used; use "readiness for `<named use case>`" and similarly specific wording.

- **Rationale**: Unsupported claims are a legal, reputational and trust risk in healthcare.
- **Checked by**: deterministic claims linter over drafts and templates; Scenario E; approval
  workflow refusing publish without Claim + evidence.

### VI. ICP Focus
The two initial ICPs are (1) HIE / program operator and (2) mid-size health system. Medtech is on
hold; payers, multi-site practices and biotech are excluded. There MUST be no silent broadening.
Changes to ICP or routing policy MUST be explicit, versioned and approved, with rationale.

- **Rationale**: Narrow focus is what makes the two launch offers testable.
- **Checked by**: versioned ICP/routing policy records with approver and rationale; tests that
  excluded segments are never prioritised (`helixbio` fixture); audit of policy changes.

### VII. Buyer Value Before Automation Volume
The system MUST optimise for validated problems and appropriately scoped opportunities, not
message counts. "Do nothing" and "not qualified" MUST be first-class, recordable outcomes.

- **Rationale**: Volume metrics reward spam; buyer-validated problems build the pipeline.
- **Checked by**: NextBestAction and qualification schemas that include do-nothing/not-qualified
  values; analytics that report validated-problem metrics alongside any send volume.

### VIII. Human Approval For External Commitments And Outbound Communication
Human approval MUST be obtained for first-time campaigns, personalised high-value messages,
AI-drafted replies, messages using uncertain hypotheses, claims using internal case-study
evidence, and offer/campaign/ICP policy changes. AI agents MUST NOT send messages, commit to
price/scope/SLA, mark funding path or economic buyer as confirmed, or override suppression.

- **Rationale**: External commitments are irreversible and carry the company's name.
- **Checked by**: approval-state gate in the send path; RBAC tests; tests that AI actors cannot
  perform restricted transitions.

### IX. Deterministic Rules For Policy Decisions
Eligibility, permissions, suppression, unsubscribe, capacity, PHI-boundary and SQL rules MUST be
plain, versioned, unit-tested code. An LLM MUST NOT make or override these decisions.

- **Rationale**: Policy decisions must be repeatable, auditable and free of model variance.
- **Checked by**: unit tests per rule in `packages/domain`; static check that rule modules do not
  import AI/provider adapters; Scenarios F and G.

### X. Structured AI Outputs
Every AI component MUST return schema-validated JSON (Zod/JSON Schema) containing entity IDs,
evidence refs, confirmed facts vs inferences vs unknowns, confidence band, concise rationale,
model and prompt/schema version, and review status. Hidden chain-of-thought MUST NOT be
persisted. Invalid output MUST be rejected and retried or escalated, never silently accepted.

- **Rationale**: Unvalidated model output cannot be audited or safely consumed downstream.
- **Checked by**: contract tests in `packages/ai-contracts`; tests that malformed output triggers
  retry/escalation; storage tests showing no reasoning traces are persisted.

### XI. Untrusted Input
Web pages, RFPs, job posts, uploads and emails MUST be treated as data, never as instructions.
Prompt-injection defences and tool restriction for agents processing such input are mandatory.

- **Rationale**: Scraped and inbound content is attacker-controllable.
- **Checked by**: injection fixtures in scenario tests; tests that agents handling untrusted
  content have a minimal, explicit tool allow-list.

### XII. Explainable Recommendations
Every recommendation MUST answer: why this, why now, why this person, and what would change it.

- **Rationale**: Operators can only approve or challenge what they can understand.
- **Checked by**: required explanation fields in the recommendation schema; scenario assertions
  on explanation content.

### XIII. Delivery Capacity Is A First-Class Constraint
An offer MUST NOT be recommended when its capacity is exhausted or delivery readiness is not
established. Alternatives (wait-list, Offer 5, research, do nothing) MUST be surfaced instead.

- **Rationale**: Over-promising delivery harms both buyers and the service.
- **Checked by**: deterministic capacity check in routing; Scenario G.

### XIV. Privacy And Data Minimisation
The system MUST collect only the minimum business-contact data needed, honour communication
preferences, send only lawful, permission-aware email, and MUST NOT use deceptive identities or
spam-filter evasion.

- **Rationale**: Respect for recipients is both a legal obligation and a brand requirement.
- **Checked by**: contact-field allow-list in schema; suppression/consent tests; Scenario F;
  review of email templates for sender identity and unsubscribe handling.

### XV. Provider Independence
All external services (research, public data, enrichment, LLM, email, calendar, CRM, storage)
MUST sit behind adapter interfaces in `packages/providers`, each with a fake implementation used
in tests. Domain code MUST NOT import vendor SDKs directly.

- **Rationale**: Open provider decisions must not block or lock in the design; tests must be
  hermetic.
- **Checked by**: dependency-boundary lint; CI runs the full suite against fakes only.

### XVI. Modular Monolith First
The system MUST be one deployable API/worker process plus an internal UI, with enforced module
boundaries. Splitting into services MUST be approved via ADR.

- **Rationale**: A small team and unproven product do not justify distributed-system cost.
- **Checked by**: module-boundary lint rules in CI; ADR required in review for any new
  deployable.

### XVII. Test Before Autonomous Action
Automated behaviour MUST NOT ship without unit, contract and scenario tests. Canonical scenarios
A–G in `docs/context/04-acceptance-scenarios.md` MUST pass before MVP release.

- **Rationale**: Automation amplifies errors; tests are the precondition for trust.
- **Checked by**: CI test gates; release checklist confirming scenarios A–G are green.

### XVIII. Hypotheses Are Labelled
All targets, conversion rates, offer scores and effort estimates taken from the source MUST be
stored and displayed as hypotheses (status `hypothesis`) until replaced by measured data.

- **Rationale**: Source numbers are starting guesses, not benchmarks.
- **Checked by**: status field required on these records; UI tests that hypothesis values carry
  a visible label.

## Engineering Standards

- TypeScript MUST run in strict mode across all packages and apps.
- Lint and format checks MUST run in CI and MUST pass before merge.
- Database migrations MUST be forward-only and reviewed.
- Idempotency keys MUST be required on all inbound webhooks and job handlers.
- Correlation IDs MUST propagate through requests, jobs and AI invocations.
- Logs MUST be structured and redacted; secrets MUST never be committed to the repository.
- **Checked by**: `tsconfig` strict flag check, CI lint/format jobs, migration review checklist,
  handler tests for duplicate delivery, log-redaction tests and secret scanning in CI.

## Security Baseline

- Access MUST use RBAC with these roles: GTM operator, research analyst, technical SME reviewer,
  sales/service lead, campaign approver, administrator, read-only executive.
- Permissions MUST follow least privilege.
- Every state change and approval MUST write an audit event.
- Transport and storage MUST be encrypted.
- **Checked by**: role/permission matrix tests, audit-event tests per state transition, and
  infrastructure configuration review.

## Quality Gates

- Before merge, every feature MUST pass `/speckit-clarify`, `/speckit-analyze` with no CRITICAL
  findings, and `/speckit-converge` reporting Converged.
- Test coverage MUST be at least 80% on `packages/domain` and `packages/ai-contracts`, enforced
  in CI.
- **Checked by**: PR checklist referencing gate outputs; CI coverage thresholds.

## Data Handling In The Repository

- Only synthetic data MAY exist in the repository, including fixtures, tests, logs and prompts
  (`tests/fixtures/synthetic-orgs/`). Real prospect data MUST exist only in deployed
  environments.
- **Checked by**: fixture review, secret/PII scanning in CI, and the `example.org`-style
  synthetic-identifier convention.

## Governance

- This constitution supersedes all other guidance, including `CLAUDE.md` and feature specs where
  they conflict.
- Amendments MUST be made by pull request and MUST include a semantic version bump, rationale and
  migration notes. MAJOR: removal or redefinition of a principle; MINOR: new principle/section or
  materially expanded guidance; PATCH: clarification or wording.
- Material architectural and policy decisions MUST be recorded as ADRs in `docs/adr`.
- Every PR review MUST verify compliance with this constitution; any deviation MUST be justified
  in the PR and, if lasting, recorded as an ADR or amendment.
- Runtime guidance for agents lives in `CLAUDE.md`; business source of truth is
  `docs/context/00-source-prompt.md`, with gaps recorded in `docs/context/05-open-questions.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-02 | **Last Amended**: 2026-11-02
