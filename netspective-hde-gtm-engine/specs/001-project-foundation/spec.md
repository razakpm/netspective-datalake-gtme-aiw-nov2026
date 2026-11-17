# Feature Specification: Project Foundation

**Feature Branch**: `001-project-foundation`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Project Foundation for the Netspective Healthcare Data Engineering GTM Engine — a secure, observable, testable skeleton on which every later feature can be built as a vertical slice. No GTM business features yet." (full description in the originating `/speckit-specify` prompt; see `docs/context/00-source-prompt.md`, Feature 001, and `docs/context/01-guardrails.md`)

## Clarifications

### Session 2026-11-12

- Q: When the PHI guard flags content, should the default be to reject it outright or to hold it in quarantine for human review? → A: Reject by default; quarantine only at entry points explicitly configured for review (recommended option accepted; recorded as open question #23).

## User Scenarios & Testing *(mandatory)*

The foundation delivers no GTM business capability. Its "users" are internal staff who must sign in safely and the engineers and developers who will build every later feature on top. Each story is an independently testable slice of that platform.

### User Story 1 - Controlled access for internal users (Priority: P1)

An administrator invites internal colleagues and assigns each one or more roles (GTM operator, research analyst, technical SME reviewer, sales/service lead, campaign approver, administrator, read-only executive). Each colleague signs in with the company identity provider and sees only the areas their roles permit.

**Why this priority**: Every later feature depends on knowing who is acting and what they may do. Least-privilege access and attributable actions are prerequisites for audit, approvals and the human-approval rules in the constitution (Principle VIII).

**Independent Test**: Can be fully tested by inviting a user, assigning a role, signing in as that user, and confirming that permitted areas are visible and forbidden actions are refused.

**Acceptance Scenarios**:

1. **Given** a signed-in administrator, **When** they invite a colleague and assign two roles, **Then** the colleague can sign in and holds the union of those roles' permissions and nothing more.
2. **Given** a signed-in user without the administrator role, **When** they attempt any user-management action, **Then** the action is refused with a "forbidden" outcome and an audit event records the denied attempt.
3. **Given** an invited user holding no roles, **When** they sign in, **Then** they are authenticated but see no functional areas and can perform no actions, and are told to contact an administrator.
4. **Given** a user who is not invited or whose access has been revoked, **When** they attempt to sign in, **Then** access is denied and no session is created.
5. **Given** a signed-in user, **When** the administrator removes one of their roles, **Then** the removed permissions stop applying no later than the user's next request after the change is saved.

---

### User Story 2 - Immutable audit trail (Priority: P1)

Every state-changing action in the system produces an audit event recording who did it, what they did, to which entity, a summary of before and after, when, and a correlation ID that ties it to the originating request or job. Audit events cannot be edited or deleted by any user.

**Why this priority**: The constitution requires an audit trail for every state change and approval. Retrofitting audit later would leave gaps, so it must exist before any business data does.

**Independent Test**: Can be tested by performing a state change (e.g. role assignment) and a denied attempt, then confirming each has exactly one audit event with all required fields, and that no interface allows altering it.

**Acceptance Scenarios**:

1. **Given** any state-changing action succeeds, **When** it completes, **Then** exactly one audit event exists with actor, action, entity, before/after summary, timestamp and correlation ID.
2. **Given** an action is denied for lack of permission, **When** the denial occurs, **Then** an audit event records the actor, the attempted action and the denial.
3. **Given** an existing audit event, **When** anyone (including an administrator) attempts to modify or delete it, **Then** the attempt is refused and itself audited.
4. **Given** an action that fails part-way, **When** the failure is handled, **Then** no audit event claims a change that did not occur.
5. **Given** the before/after summary of a change, **When** it contains content classified as prohibited, **Then** that content is withheld from the audit event.

---

### User Story 3 - PHI boundary guard and data classification (Priority: P1)

Every piece of content carries a data classification (public, business_contact, confidential_commercial, internal_case_study_restricted, sensitive_operational_metadata, prohibited). A shared guard inspects incoming content and rejects it by default (or, only at entry points explicitly configured for review, quarantines it for restricted review) when it matches PHI-like patterns before it is stored, logged, or sent to any external provider.

**Why this priority**: Non-PHI by default is a constitutional MUST (Principle IV). The guard must exist before any data enters the system, and it protects every later feature.

**Independent Test**: Can be tested by submitting synthetic PHI-like samples (SSN, MRN with a name, date of birth with a name, tabular patient rows) and confirming each is blocked at the system boundary, never stored in clear, never logged and never sent to a provider.

**Acceptance Scenarios**:

1. **Given** a request body containing a synthetic SSN, **When** it reaches the system boundary, **Then** it is blocked with an explanatory error and an audit event records the block without the offending content.
2. **Given** content with an MRN next to a person name, a DOB next to a person name, or tabular rows resembling patient records, **When** submitted, **Then** each is blocked or quarantined as suspected PHI.
3. **Given** content suspected to be PHI, **When** it is blocked or quarantined, **Then** an operator-visible notification is raised and the content is never written to logs, never included in any provider call, and never reaches a language-model prompt.
4. **Given** quarantined content, **When** a user without quarantine access tries to view it, **Then** access is refused and audited.
5. **Given** content that resembles PHI but is a false positive, **When** it is blocked, **Then** an authorised reviewer can see the block reason and release or discard it, with the decision audited.
6. **Given** any new field or content type, **When** it is introduced without a classification, **Then** it is rejected at validation time (no unclassified data).

---

### User Story 4 - Reliable background jobs (Priority: P2)

Engineers can schedule background jobs that run once per idempotency key, are retried with backoff on failure, and, if they still fail, are marked failed with details visible to administrators.

**Why this priority**: All later automation (research, imports, sends) relies on safe, repeatable job execution, but it is not needed before access control, audit and the PHI guard exist.

**Independent Test**: Can be tested with a synthetic job that always throws and one that succeeds; confirm retry behaviour, final failed state, administrator visibility, and single execution on duplicate submission.

**Acceptance Scenarios**:

1. **Given** a job submitted twice with the same idempotency key, **When** both are processed, **Then** the work is performed once.
2. **Given** a job that throws, **When** it runs, **Then** it is retried according to the retry policy with increasing delays, up to the configured maximum.
3. **Given** a job that exhausts its retries, **When** the final attempt fails, **Then** it is marked failed with error details visible to administrators, and an audit event records the transition.
4. **Given** a burst of jobs far above normal volume (job storm), **When** they arrive, **Then** concurrency limits keep the system responsive and no job is silently dropped.
5. **Given** a failed job error, **When** its details are displayed or logged, **Then** prohibited content and secrets are redacted.
6. **Given** a recurring schedule, **When** its time arrives on multiple instances, **Then** the job is enqueued once per scheduled occurrence.

---

### User Story 5 - Safe inbound webhooks (Priority: P2)

Inbound webhook deliveries are stored raw first, with the result of signature verification recorded, and then processed idempotently by delivery ID.

**Why this priority**: Email and calendar integrations in later features depend on trustworthy inbound events; the foundation must handle the pattern generically.

**Independent Test**: Can be tested by sending a correctly signed delivery, an incorrectly signed delivery and a replay of the same delivery ID, and checking stored records and processing outcomes.

**Acceptance Scenarios**:

1. **Given** a webhook delivery, **When** it arrives, **Then** after PHI guard inspection the raw payload and headers are stored before any processing, with verification status (verified, failed, or not-verifiable) recorded.
2. **Given** the same delivery ID arrives twice, **When** both are received, **Then** processing happens once and the second is recorded as a duplicate.
3. **Given** a delivery with an invalid signature, **When** it is received, **Then** it is stored as failed verification and is never processed.
4. **Given** a delivery whose timestamp is outside the allowed skew window, **When** it is received, **Then** it is rejected as stale or future-dated and recorded as such.
5. **Given** a delivery larger than the size limit, **When** it arrives, **Then** it is rejected without being fully stored or processed.
6. **Given** a delivery containing suspected PHI, **When** it is received, **Then** the PHI guard blocks or quarantines it before processing (the raw copy is not retained in clear).

---

### User Story 6 - Traceable, safe logging (Priority: P2)

Every request and job carries a correlation ID through all log lines and audit events. Logs are structured and redact secrets and sensitive fields.

**Why this priority**: Observability and log safety make every later feature debuggable without leaking sensitive data.

**Independent Test**: Can be tested by running the test suite with seeded secrets and PHI-like strings, then scanning all captured log output.

**Acceptance Scenarios**:

1. **Given** an incoming request without a correlation ID, **When** it is handled, **Then** one is generated and appears in every related log line, audit event and job.
2. **Given** an incoming request with a well-formed correlation ID, **When** handled, **Then** it is preserved; a malformed one is replaced.
3. **Given** a seeded secret or PHI-like test string passes through any code path, **When** logs are captured, **Then** no log line contains it.
4. **Given** a job started by a request, **When** it runs, **Then** its logs carry the originating correlation ID.

---

### User Story 7 - Provider independence (Priority: P2)

Every external service is reached through a defined interface with a fake implementation: research source, public data, contact enrichment, language model, email, calendar, CRM and file storage. Tests and local development use only the fakes.

**Why this priority**: Provider choices are still open (see `docs/context/05-open-questions.md`), and the constitution requires provider independence (Principle XV).

**Independent Test**: Can be tested by running the full test suite with only fakes configured and by confirming each interface has a passing contract test against its fake.

**Acceptance Scenarios**:

1. **Given** each of the eight provider interfaces, **When** the test suite runs, **Then** each has a fake implementation that passes a shared contract test.
2. **Given** a provider is unavailable or returns an error, **When** a caller invokes it, **Then** a typed failure is returned and recorded, and the caller does not crash.
3. **Given** any outbound provider call, **When** it is made, **Then** its payload has passed the PHI guard first.
4. **Given** the test suite, **When** it runs in CI, **Then** no test makes a real external network call.

---

### User Story 8 - AI invocation record (Priority: P2)

Every language-model call is recorded with model, prompt version, schema version, token counts, cost estimate, latency and validation result, without storing prohibited content.

**Why this priority**: The constitution requires structured, versioned, auditable AI output (Principle X). Later AI features need this ledger from day one.

**Independent Test**: Can be tested using the fake language-model provider to make valid, invalid-output, and PHI-flagged calls, and inspecting the resulting records.

**Acceptance Scenarios**:

1. **Given** an AI call completes, **When** it is recorded, **Then** the record contains model, prompt version, schema version, input and output token counts, cost estimate, latency and validation result.
2. **Given** an AI call whose output fails schema validation, **When** it is handled, **Then** the record marks it invalid, and the output is not accepted as a result.
3. **Given** input flagged as prohibited, **When** an AI call is attempted, **Then** the call is refused before reaching any provider and the refusal is recorded without the content.
4. **Given** an AI invocation record, **When** it is viewed, **Then** it contains no raw prompt or response content classified as prohibited and no hidden reasoning traces.

---

### User Story 9 - One-command local run and CI (Priority: P3)

A developer can start the whole system locally with one command, populated with synthetic seed data. Continuous integration runs lint, type-check, unit, migration and contract tests on every change.

**Why this priority**: It speeds every later feature but is not a runtime safety need.

**Independent Test**: Can be tested by following the quickstart on a clean machine and by opening a pull request and observing CI results.

**Acceptance Scenarios**:

1. **Given** a clean checkout with prerequisites installed, **When** a developer runs the single documented start command, **Then** the system is running locally with synthetic seed data and no real data or real provider credentials.
2. **Given** a pull request, **When** CI runs, **Then** lint, type-check, unit, migration and contract tests all execute and a failure blocks merge.
3. **Given** the seed data, **When** inspected, **Then** it consists only of synthetic organisations, people and secrets (for example `example.org` addresses).
4. **Given** a documented container build, **When** it is run, **Then** it produces a runnable image that passes the health and readiness checks.

---

### User Story 10 - Health and readiness (Priority: P3)

Health and readiness endpoints let operators and deployment tooling tell whether the system is alive and ready to serve (including its dependencies).

**Why this priority**: Needed for deployment and monitoring, and simple to deliver.

**Independent Test**: Can be tested by querying both endpoints with dependencies healthy and with a dependency unavailable.

**Acceptance Scenarios**:

1. **Given** the system is running, **When** the health endpoint is queried, **Then** it reports alive without requiring sign-in.
2. **Given** a required dependency is unavailable, **When** the readiness endpoint is queried, **Then** it reports not-ready with a non-sensitive reason.
3. **Given** the health or readiness response, **When** inspected, **Then** it contains no secrets, no user data and no internal hostnames.

---

### Edge Cases

- **Identity provider outage**: signed-in users with valid sessions continue until expiry; new sign-ins fail with a clear, non-technical message; no fallback local password path exists; the outage is logged and surfaced via readiness.
- **User with zero roles**: authenticated but cannot access any functional area or perform any action; shown a "no access assigned" message (US1).
- **Clock skew on webhook signatures**: deliveries within the allowed skew window are accepted; outside it they are rejected as stale or future-dated and recorded (US5).
- **Job storms**: bursts are queued under concurrency and rate limits; none are dropped; administrators can see queue depth (US4).
- **Oversized payloads**: requests and webhook bodies above the size limit are rejected early with a clear error and no partial persistence.
- **Duplicate and replayed requests**: webhook replays and duplicate job submissions are processed once.
- **Last administrator**: the system refuses to remove the administrator role from, or deactivate, the last remaining administrator.
- **Suspected PHI in unexpected places**: PHI-like content found in headers, filenames, query strings or error messages is treated like body content and blocked or redacted.
- **PHI detector false positives**: legitimate content blocked in error can be reviewed and released by an authorised reviewer; the decision is audited (US3).
- **Audit write failure**: if an audit event cannot be recorded, the state change it describes does not commit.
- **Invalid or expired session**: the user is signed out and the attempted action is not performed.

## Requirements *(mandatory)*

### Functional Requirements

**Identity, access and roles**

- **FR-001**: The system MUST let administrators invite internal users and assign one or more of these roles: GTM operator, research analyst, technical SME reviewer, sales/service lead, campaign approver, administrator, read-only executive.
- **FR-002**: The system MUST authenticate users only through the company identity provider and MUST NOT offer local passwords.
- **FR-003**: The system MUST deny access to users who have not been invited or whose access has been revoked.
- **FR-004**: The system MUST enforce authorisation on every action using the union of the user's roles, following least privilege, with deny as the default.
- **FR-005**: The system MUST restrict user management (invite, assign/remove roles, deactivate) to administrators; any other attempt MUST be refused and audited.
- **FR-006**: The system MUST show each user only the areas their roles permit and MUST enforce the same limits on the server side regardless of what the interface displays.
- **FR-007**: The system MUST prevent removal of the last remaining administrator.
- **FR-008**: The system MUST allow a user with zero roles to authenticate while granting no functional access.
- **FR-009**: The system MUST NOT allow any automated or AI actor to hold roles that grant approval or user-management permissions.

**Audit**

- **FR-010**: The system MUST record an audit event for every state-changing action and every approval, containing actor, action, entity, before/after summary, timestamp and correlation ID.
- **FR-011**: The system MUST record an audit event for every denied action and every PHI block or quarantine.
- **FR-012**: Audit events MUST be append-only; no role, including administrator, may edit or delete an individual event. The only permitted removal is of a whole expired retention period (FR-053) by a privileged, separately audited maintenance operation.
- **FR-013**: A state change MUST NOT commit if its audit event cannot be recorded.
- **FR-014**: Audit event summaries MUST NOT contain content classified as prohibited or any secret.

**Data classification and PHI boundary**

- **FR-015**: The system MUST define the classifications public, business_contact, confidential_commercial, internal_case_study_restricted, sensitive_operational_metadata and prohibited, and MUST require every stored field or content type to declare one.
- **FR-016**: PHI, patient-level data and credentials MUST be treated as `prohibited` and MUST NOT be stored, logged, or sent to any provider or language model.
- **FR-017**: A shared PHI-boundary guard MUST inspect content at every system entry point (API requests, uploads, webhooks) and, before content is stored, logged or sent to any provider or language model, MUST reject it by default, or quarantine it only at entry points explicitly configured for human review, when it matches PHI-like patterns, including SSN, MRN adjacent to a name, DOB adjacent to a name, and tabular patient-style rows.
- **FR-018**: The guard's decisions MUST be deterministic, versioned and unit-tested, and MUST NOT rely on a language model.
- **FR-019**: Blocked or quarantined content MUST raise an operator notification and an audit event that excludes the content itself.
- **FR-020**: Quarantined content MUST be accessible only to explicitly authorised roles, MUST be audited on access, and MUST be released or discarded only by an authorised human with the decision audited.
- **FR-021**: The guard MUST also apply to content in headers, filenames, query strings and error messages.
- **FR-022**: Content the guard cannot classify with confidence MUST be treated as suspected and handled as rejected or quarantined, never silently accepted.

**Jobs**

- **FR-023**: The system MUST support scheduling one-off and recurring background jobs.
- **FR-024**: Each job MUST carry an idempotency key, and duplicate submissions with the same key MUST result in a single execution.
- **FR-025**: Failed job attempts MUST be retried with increasing delays up to a configurable maximum, after which the job MUST be marked failed.
- **FR-026**: Failed jobs MUST be visible to administrators with redacted error details, and each state transition MUST be audited.
- **FR-027**: The system MUST apply concurrency and rate limits so a burst of jobs cannot exhaust capacity or silently drop jobs.
- **FR-028**: A recurring job MUST be enqueued once per scheduled occurrence even when multiple instances run.

**Webhooks**

- **FR-029**: The system MUST run the PHI guard on every inbound webhook delivery (including deliveries that fail signature verification) before anything is persisted, and MUST then store the delivery raw with its verification status (verified, failed, not-verifiable) before any processing. A delivery the guard blocks is recorded as metadata only (FR-032).
- **FR-030**: The system MUST process deliveries only when verification passes (or the source is explicitly configured as not-verifiable and flagged), and MUST process each delivery ID at most once.
- **FR-031**: The system MUST reject deliveries outside a configurable timestamp skew window and deliveries over a configurable size limit.
- **FR-032**: The raw copy of a webhook MUST NOT retain content that the PHI guard blocked.

**Correlation and logging**

- **FR-033**: The system MUST assign a correlation ID to every request and job (preserving a well-formed inbound ID) and propagate it to every log line, audit event, job and provider call.
- **FR-034**: Logs MUST be structured and MUST redact secrets and sensitive fields.
- **FR-035**: No log output produced by the test suite MAY contain a seeded secret or a PHI-like test string; this MUST be verified by an automated check.

**Providers and AI invocation**

- **FR-036**: The system MUST access every external service through an interface: research source, public data, contact enrichment, language model, email, calendar, CRM and file storage.
- **FR-037**: Each interface MUST have a fake implementation that passes a shared contract test, and the automated test suite MUST use only fakes.
- **FR-038**: Provider failures MUST be returned as typed, recorded outcomes without crashing callers.
- **FR-039**: Every payload bound for a provider MUST pass the PHI guard first; the file-storage interface MUST accept only non-prohibited artifacts.
- **FR-040**: The system MUST record every language-model invocation with model, prompt version, schema version, input and output token counts, cost estimate, latency and validation result.
- **FR-041**: Invocation records MUST NOT contain prohibited content or hidden reasoning traces.
- **FR-042**: Language-model output that fails schema validation MUST be marked invalid, and MUST NOT be accepted as a result.
- **FR-043**: The system MUST refuse a language-model call whose input is flagged as prohibited, before it reaches the provider, and MUST record the refusal.

**Operations and delivery**

- **FR-044**: The system MUST expose unauthenticated health and readiness endpoints that reveal no secrets, user data or internal hostnames; readiness MUST reflect the availability of required dependencies.
- **FR-045**: A developer MUST be able to run the complete system locally with one documented command, using only synthetic seed data and no real provider credentials.
- **FR-046**: Continuous integration MUST run lint, type-check, unit, migration and contract tests, and a failure MUST block merge.
- **FR-047**: Database migrations MUST be forward-only and reviewed, consistent with the constitution.
- **FR-048**: The repository MUST contain only synthetic data and no secrets; a documented container build MUST exist.
- **FR-049**: Request and webhook bodies above a configurable size limit MUST be rejected before processing.
- **FR-050**: Any data-handling or privacy-relevant decision made in this feature MUST be recorded as an architecture decision record.

**Encryption, untrusted input and retention**

- **FR-051**: All traffic between users, the web application, the API, the database and external providers MUST use encrypted connections, and all stored data (database, file storage, quarantine content) MUST be encrypted at rest. In production the system MUST refuse to start when a required encrypted connection is not configured.
- **FR-052**: Content from external sources (web pages, RFPs, job posts, uploads, emails and webhook payloads) MUST be given to a language model only as delimited data, never as instructions. A call that processes such content MUST run with no tool access unless a tool is explicitly allow-listed, and these defences MUST be covered by automated prompt-injection tests.
- **FR-053**: Each stored data category MUST have a configured retention period and an automated, audited removal mechanism. Defaults (hypotheses pending the privacy lead, open questions #17 and #24): audit events 7 years (removed by whole expired period only, FR-012); AI invocation records 12 months; webhook raw body and headers 90 days (metadata kept); quarantined content 30 days maximum; job payloads and error details 90 days after reaching a terminal state; API idempotency records 24 hours.

**Sessions and API idempotency**

- **FR-054**: A signed-in session MUST end after a maximum absolute lifetime and after a period of inactivity, and an expired or invalid session MUST NOT perform any action and MUST require a new sign-in. Defaults (hypotheses, configurable): 8 hours absolute and 30 minutes idle. Valid sessions continue during an identity provider outage until they expire (see Edge Cases).
- **FR-055**: Every state-changing API request that creates or modifies users or roles MUST accept a caller-supplied idempotency key (8–128 characters). Repeating the same key with the same request MUST return the original result with no second effect; the same key with a different request MUST be rejected. Keys are scoped per caller and operation and expire after 24 hours (FR-053).

### Key Entities

- **User**: an internal person invited to use the system; has status (invited, active, deactivated) and zero or more roles.
- **Role**: a named set of permissions; one of the seven defined roles.
- **Permission**: a single allowed action over an area of the system.
- **Audit Event**: immutable record of an action or denial: actor, action, entity, before/after summary, timestamp, correlation ID, outcome.
- **Job**: a unit of background work with an idempotency key, schedule, attempt count, state (queued, running, succeeded, failed) and redacted error details.
- **Webhook Delivery**: a raw inbound delivery with source, delivery ID, received time, verification status, processing status and duplicate marker.
- **Data Classification**: one of the six classifications attached to stored fields and content types.
- **PHI Detection Result**: outcome of the guard for a piece of content: decision (allow, reject, quarantine), detector rule IDs that matched, guard version; never the content itself.
- **Quarantine Item**: content held for restricted review with reason, access log and eventual disposition (released, discarded).
- **Provider Connection**: configured use of an external service via its interface, including whether it is a fake or real implementation.
- **AI Invocation Record**: ledger entry for a language-model call: model, prompt version, schema version, token counts, cost estimate, latency, validation result, refusal flag.
- **Prompt Version**: versioned identifier of a prompt template and its output schema.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A non-administrator's attempt to manage users is refused and audited in 100% of tested cases.
- **SC-002**: 100% of state-changing actions in the automated test suite produce exactly one audit event containing all required fields.
- **SC-003**: Replaying the same webhook delivery ID results in exactly one processing run in 100% of tested replays, including concurrent replays.
- **SC-004**: A job that always fails is retried the configured number of times and is then visible as failed to administrators; no failed job is left in a non-terminal state.
- **SC-005**: 100% of the synthetic PHI-like samples (SSN, MRN with name, DOB with name, tabular patient rows) are blocked or quarantined at the boundary; none are stored in clear, logged, or sent to a provider.
- **SC-006**: Scanning all log output from a full test run finds zero occurrences of any seeded secret or PHI-like test string.
- **SC-007**: A developer on a clean machine goes from checkout to a running local system with synthetic data using one command, within 15 minutes excluding downloads (starting hypothesis).
- **SC-008**: Every change to the main branch is gated by lint, type-check, unit, migration and contract tests; no change merges with any of them failing.
- **SC-009**: Health and readiness checks respond within 1 second under normal conditions, and readiness correctly reports not-ready when a required dependency is down in 100% of tested cases.
- **SC-010**: All eight provider interfaces have a fake implementation passing the shared contract test, and the full automated suite makes zero real external network calls.
- **SC-011**: Line coverage is at least 80% on the shared domain rules and the AI output-contract packages, per the constitution's quality gate.
- **SC-012**: In a production configuration, 100% of tested configurations lacking an encrypted database connection or encrypted web-to-API connection are refused at start-up (FR-051).
- **SC-013**: 100% of the prompt-injection fixtures, when supplied as external content to a language-model call, are treated as data: none changes the call's instructions or triggers a tool (FR-052).
- **SC-014**: Every retention period in FR-053 has an automated removal that is exercised by a test and writes an audit event.
- **SC-015**: Repeating a user-management request with the same idempotency key produces exactly one change in 100% of tested replays, including concurrent replays (FR-055).
- **SC-016**: An expired or idle session performs no action in 100% of tested cases and the user is asked to sign in again (FR-054).

## Assumptions

- The company identity provider is OIDC-capable; the specific provider (Google or Microsoft) is open question #8 and will be configurable. Until decided, development and test use a fake identity provider. Assumed default, recorded in `docs/context/05-open-questions.md`.
- Invited users are internal staff with company accounts; external users and customer-facing access are out of scope.
- Users may hold multiple roles; permissions are the union of role permissions. There are no deny rules in this feature. Foundation permission matrix (hypothesis, open question #27): administrator holds all foundation permissions; gtm_operator holds jobs.read and webhooks.read; read_only_executive holds audit.read, jobs.read and ai_invocations.read; other roles hold none until later features add permissions.
- Only administrators can manage users. Quarantine review is limited to administrators until a dedicated role or permission is defined. Assumed default.
- Suspected PHI is rejected by default; quarantine applies only at entry points explicitly configured for review (clarified 2026-11-12, open question #23).
- Retention defaults are stated in FR-053. Audit and AI-invocation values follow open question #17; the others (webhook bodies, quarantine, job details, idempotency records) are new hypotheses tracked as open question #24. Contacts and signals (open question #17) belong to later features. All are pending the privacy lead.
- Numeric defaults (retry count and delays, webhook skew window, payload size limits, concurrency limits) are configurable and will be fixed in the plan; they are hypotheses until tuned from measured behaviour.
- Cost estimates for AI invocations use configured per-model rates and are estimates, not billing records.
- Hosting and cloud target are undecided (open question #16); this feature delivers only a documented container build.
- The `docs/context/00-source-prompt.md` file in this repository is the runbook and does not contain the sections numbered 24–33 referenced in the originating prompt; this spec relies on the runbook's Feature 001 section, the guardrails and the constitution. Any missing business detail is recorded as a gap rather than invented.
- All data in the repository, including seed data and fixtures, is synthetic; real prospect data exists only in deployed environments.
- Out of scope: account, signal, offer, workshop and campaign logic; any customer-facing function; production cloud deployment automation beyond a documented container build.
