# Feature Specification: Accounts, Contacts, Stakeholders and ICP Fit

**Feature Branch**: `002-accounts-contacts-icp`

**Created**: 2026-11-16

**Status**: Draft

**Input**: User description: "Accounts, Contacts, Stakeholders and ICP fit — operators can import and maintain target organisations and contacts, resolve duplicates, record stakeholder roles honestly, and get a consistent, explainable ICP fit assessment that is separate from intent." (full description in the originating `/speckit-specify` prompt; see `docs/context/00-source-prompt.md`, Feature 002, `docs/context/01-guardrails.md`, `docs/context/02-glossary.md` and `docs/context/04-acceptance-scenarios.md`)

## Clarifications

### Session 2026-11-16

- Q: Which size measure should decide whether a health system counts as "mid-size" for ICP 2? → A: Staffed bed count, with a configurable band (min and max) recorded as a number on the account; where no number is recorded, an analyst's recorded judgement yields "possible", never "strong".
- Q: When two organisations have similar names but no shared web domain, should the import still flag them as possible duplicates? → A: Only when organisation type or geography also matches; exact (non-shared) domain matches are always flagged.
- Q: When an administrator removes a contact on request, what should the system keep so the person is still not contacted? → A: All personal details are erased; only a suppression marker holding a one-way hash of the business email, with date and reason, is kept, and re-imports of that email are blocked.
- Q: When a contact import row matches a person already on file but has a different title or account, where should the conflict go for a decision? → A: It is reported as "conflict" and queued in the same review queue as merge candidates; the existing record is unchanged until an operator accepts or rejects the new values.
- Q: Who may add or change an account's staffed bed count, and does that change re-run the ICP assessment automatically? → A: Operators and leads may edit it; the edit is audited and does not re-assess; a person runs a new assessment deliberately and the earlier one stays in history.

## User Scenarios & Testing *(mandatory)*

This feature gives the GTM team a trustworthy list of who they may talk to and whether it is worth doing so. It is the first business capability built on the foundation (feature 001): organisations ("accounts"), the people at them ("contacts"), the role each person plays in a buying decision, and a consistent, explainable answer to "is this organisation one of our two target types?". It does not research organisations, collect signals or send anything (features 003, 004 and 009). All data used and shown is non-PHI business data; the sample organisations and people in tests are synthetic.

### User Story 1 - Import and de-duplicate organisations (Priority: P1)

A GTM operator uploads a CSV of target organisations (name, aliases, web domains, organisation type, geography, notes). Before anything is saved they see a validation report: which rows are valid, which have problems and exactly why. Rows that appear to describe an organisation already on file are matched by domain and by name or alias and flagged as merge candidates for a person to review. Nothing is ever merged automatically.

**Why this priority**: Every other story needs accounts to exist. Duplicate or silently merged accounts would corrupt every later assessment, suppression and campaign decision, so import and duplicate handling must be safe and repeatable first.

**Independent Test**: Can be fully tested by importing a CSV containing valid rows, invalid rows and near-duplicates, reading the validation report, resolving the merge candidates, and importing the same file again.

**Acceptance Scenarios**:

1. **Given** a CSV with valid and invalid rows, **When** the operator submits it, **Then** a report lists, per row, whether it was created, updated, unchanged, rejected or flagged, with a specific reason for every rejection, and valid rows are saved even if other rows fail.
2. **Given** a row whose domain or name matches an existing account, **When** it is imported, **Then** it is flagged as a merge candidate for review, the existing account is not altered by the match, and the operator is told which account it matched and why.
3. **Given** a merge candidate, **When** an authorised person approves the merge, **Then** the accounts are combined with every name, domain, contact and note kept, the decision is recorded with who made it and why, and a rejected candidate is remembered so it is not proposed again for the same pair.
4. **Given** a file that has already been imported, **When** it is imported again unchanged, **Then** no account, alias, domain or contact is created or changed and the report shows every row as unchanged.
5. **Given** a file containing a row with content that looks like patient information, **When** it is imported, **Then** that row is rejected without storing or echoing the content, and the rest of the file is reported normally.

---

### User Story 2 - Import contacts with a lawful source (Priority: P1)

A GTM operator uploads a CSV of contacts (name, title, department, business email, profile URL, the account they belong to). Every contact must carry where the information came from and the basis on which it may be used. Contacts without a lawful source, without a permitted-use basis, or whose email is a personal address are rejected with a reason. Accepted contacts are attached to their account.

**Why this priority**: Contacts are the only personal data the system holds, and the rule "no lawful source, no contact" is a privacy guardrail that must hold from the first import, not be added later.

**Independent Test**: Can be tested by importing contacts with and without a source and basis, with personal and business email addresses, and with people already on file, then checking who was accepted and why others were not.

**Acceptance Scenarios**:

1. **Given** a contact row with a recognised source and a permitted-use basis, **When** it is imported, **Then** the contact is created, linked to its account, and the source and basis are stored with it.
2. **Given** a contact row missing the source or the permitted-use basis, **When** it is imported, **Then** the row is rejected with that reason and no contact is created.
3. **Given** a contact row whose email uses a personal mailbox domain, **When** it is imported, **Then** the row is rejected as not a business email.
4. **Given** a contact whose account does not exist, **When** the row is imported, **Then** it is rejected with "unknown account" and is not attached to a guessed one.
5. **Given** a person already on file (same business email), **When** a row for them is imported again, **Then** their record is not duplicated, and a conflicting title or account is reported rather than silently overwritten.
6. **Given** a contact who has been suppressed, **When** a file containing them is imported, **Then** they remain suppressed.

---

### User Story 3 - See why an organisation fits (or not) an ICP (Priority: P1)

A GTM operator opens an organisation and sees its ICP fit, shown separately from any buying intent: for each of the two target types (ICP 1: health information exchange or program operator; ICP 2: mid-size health system) which criteria are met, which are not, which evidence supports each, how confident the result is, and an overall status of strong, possible, weak, excluded or unknown. The status comes from fixed rules, not from a language model; an AI suggestion may be shown beside it, clearly labelled, but never replaces it.

**Why this priority**: Explainable, repeatable fit is the filter that stops effort being spent on the wrong organisations, and it feeds routing in later features.

**Independent Test**: Can be tested by assessing each of the synthetic organisations and checking the status, met and unmet criteria and evidence shown, and by re-running an assessment and getting the same result.

**Acceptance Scenarios**:

1. **Given** the synthetic organisation `northvale-hie` (a regional HIE with repeated sender onboarding delays), **When** it is assessed, **Then** it is **strong** for ICP 1 with its met criteria and evidence listed.
2. **Given** the synthetic organisation `riverbend-health` (a mid-size health system with a stalled AI pilot), **When** it is assessed, **Then** it is **strong** or **possible** for ICP 2 (as the evidence recorded supports) with met and unmet criteria listed.
3. **Given** the synthetic organisation `summitcare-health` (generic AI interest, no demonstrated data problem), **When** it is assessed, **Then** it is **possible** for ICP 2 and "no demonstrated data problem" appears among the **unmet** criteria.
4. **Given** an organisation with too little recorded information to judge, **When** it is assessed, **Then** the status is **unknown** and the missing information is listed, rather than a guess being presented as fact.
5. **Given** the same organisation data, evidence and ICP definition version, **When** it is assessed twice, **Then** the two results are identical.
6. **Given** an AI suggestion exists for an organisation, **When** the assessment is shown, **Then** the suggestion is labelled as AI-generated and advisory, and if it differs from the rule result the rule result is the one stored and used.
7. **Given** fit and intent are different things, **When** an assessment is shown, **Then** it contains no intent score and does not change when intent-related information changes.

---

### User Story 4 - Excluded organisation types stay out of the priority pipeline (Priority: P1)

Organisations of type medtech (on hold), payer, multi-site practice or biotech are assessed **excluded** and are not eligible for the priority pipeline. Only an administrator can lift that, by recording an explicit, versioned override with a written rationale; the override is visible wherever the organisation appears and can be revoked.

**Why this priority**: The ICPs are deliberately narrow ("no silent broadening"). Exclusion must be enforced by rule and any exception must be visible and attributable.

**Independent Test**: Can be tested by assessing the synthetic biotech `helixbio` and trying to make it priority-eligible with and without an administrator override.

**Acceptance Scenarios**:

1. **Given** the synthetic organisation `helixbio` (biotech), **When** it is assessed, **Then** its status is **excluded**, with the exclusion reason shown, and it is not eligible for the priority pipeline.
2. **Given** an excluded organisation, **When** a user who is not an administrator tries to make it priority-eligible, **Then** the attempt is refused and audited.
3. **Given** an excluded organisation, **When** an administrator records an override with a rationale, **Then** the organisation becomes priority-eligible, the override is stored as a new version with who, when and why, and the original exclusion remains visible.
4. **Given** an active override, **When** an administrator revokes it, **Then** the organisation returns to not eligible and the revocation is a further version, not an edit of history.
5. **Given** an override without a rationale, **When** it is submitted, **Then** it is rejected.

---

### User Story 5 - Record stakeholder roles honestly (Priority: P2)

A sales or service lead records, for each contact at an account, three separate things: the contact's job title as stated; the stakeholder role they probably play (inferred); and the role and authority the buyer has actually confirmed. Stakeholder roles come from a fixed list (operational user, onboarding/data-quality lead, integration lead, data engineering lead, interoperability director, data operations director, data governance lead, privacy/compliance lead, CMIO, CDO, AI governance lead, CIO, CFO, executive director, state program director, procurement contact, economic buyer, champion, technical evaluator, unknown). A contact can be marked as the **economic buyer** (confirmed) only by linking evidence of that confirmation.

**Why this priority**: Qualification rules in later features depend on a named, confirmed economic buyer. Mixing "we think" with "they said" would let unconfirmed assumptions pass as fact.

**Independent Test**: Can be tested by setting inferred and confirmed roles on a contact, then trying to confirm an economic buyer with and without evidence.

**Acceptance Scenarios**:

1. **Given** a contact, **When** a lead records title, inferred role and confirmed role, **Then** each is stored and shown separately and changing one never changes another.
2. **Given** a contact, **When** a lead sets confirmed role to economic buyer without a linked evidence record, **Then** validation fails and nothing is saved.
3. **Given** a confirmed-role change with linked evidence, **When** it is saved, **Then** the evidence is shown next to it, and the change is audited with who made it and when.
4. **Given** a contact with only an inferred role, **When** any view or rule asks whether a buyer is confirmed, **Then** the answer is "not confirmed".
5. **Given** a contact at two accounts, **When** roles are recorded, **Then** each account holds its own roles for that person.
6. **Given** a contact who leaves an organisation, **When** the lead records the departure, **Then** the relationship ends with a date, history is kept, and the person no longer counts as an active stakeholder there.

---

### User Story 6 - Manage ICP definitions as versioned configuration (Priority: P2)

An administrator views and edits the definitions of ICP 1 and ICP 2 (the criteria, which are required, and how each affects status). Every change creates a new version that must be explicitly activated by an administrator; earlier versions are kept. Each assessment records the version it was made under and keeps it, even after later versions are activated. Running a new assessment under the new version is a separate, deliberate step that leaves the old assessment in history.

**Why this priority**: ICP policy changes need human approval and traceability, and "why did this organisation score that way last month" must stay answerable.

**Independent Test**: Can be tested by assessing an organisation, editing and activating a new ICP version, confirming the old assessment is unchanged, and re-assessing under the new version.

**Acceptance Scenarios**:

1. **Given** an active ICP definition, **When** an administrator saves an edit, **Then** a new inactive version exists and the active version is unchanged until it is activated.
2. **Given** a new version, **When** an administrator activates it, **Then** new assessments use it, the activation is audited, and previous versions remain viewable.
3. **Given** assessments made under an earlier version, **When** a later version is activated, **Then** those assessments still show their original version and result.
4. **Given** a user who is not an administrator, **When** they try to edit or activate a definition, **Then** the attempt is refused and audited.
5. **Given** an invalid definition (for example no criteria, or a status rule that cannot be evaluated), **When** it is saved, **Then** it is rejected with the reason and cannot be activated.

---

### User Story 7 - Record suppression immediately and everywhere (Priority: P1)

Any signed-in user can mark a contact, or a whole account (and so every contact at it), as suppressed / do-not-contact, with a reason. Suppression takes effect immediately for every feature that could use the person or account. Suppression survives re-imports and merges. Only an administrator can lift it, with a recorded reason.

**Why this priority**: Honouring "do not contact" is a legal and trust obligation. It is also the safest direction to make easy: anyone may add a suppression, and it is rule-based, never left to an AI recommendation.

**Independent Test**: Can be tested by suppressing the synthetic contact `pat.unsubscribed@example.org` and a whole account, then asking the eligibility check for each, re-importing, and merging.

**Acceptance Scenarios**:

1. **Given** a contact, **When** any user records suppression, **Then** from that moment an eligibility check for that contact returns "suppressed" with the reason and no later feature can treat them as contactable.
2. **Given** an account, **When** any user records suppression on it, **Then** every contact at that account is treated as suppressed, including contacts added afterwards, until the account suppression is lifted.
3. **Given** a suppressed contact, **When** a contact import or an account merge includes them, **Then** they remain suppressed.
4. **Given** a suppressed contact who also works at a second account, **When** eligibility is checked at either account, **Then** they are suppressed (suppression follows the person).
5. **Given** a suppression, **When** a user who is not an administrator tries to lift it, **Then** the attempt is refused and audited; when an administrator lifts it with a reason, the removal is recorded and the history of both actions is kept.
6. **Given** any suppression change, **Then** an audit event records who, what, when and why.

---

### Edge Cases

- **One contact at two accounts**: the person is one record with a separate relationship (title, roles, dates) at each account; suppression and contact-level data follow the person.
- **Organisation renamed**: the account keeps its identity; former names are retained as aliases with the date they stopped being current, so old files and records still match.
- **Shared domains** (for example a health system and an affiliated HIE using the same domain): a domain may be marked as shared across accounts; a match on a shared domain alone is not treated as a duplicate and is never a basis for merging.
- **Personal email domains** (free consumer mailbox providers): rejected as business email; the list of such domains is configurable.
- **Contact leaves an organisation**: the relationship is ended with a date and reason; the contact record and its history remain; the person is not shown as an active stakeholder, and their suppression stays.
- **Re-import after a rename or edit**: matching uses stable identifiers (domains, aliases, business email) so a re-import never creates a second account or contact for the same thing.
- **Merge conflict**: when two accounts disagree (type, geography, notes), the merge requires the reviewer to choose; nothing is dropped silently.
- **Import contains PHI-like text** in notes or names: that row is rejected and not stored, logged or echoed.
- **Large or malformed files**: files over the size limit, with the wrong columns or encoding, are rejected whole with a clear message; partially valid files import their valid rows.
- **Type unknown or ambiguous**: the organisation can be imported but its fit is **unknown** until a type is recorded; it is never assumed to be a target type.
- **Excluded type with a strong-looking story**: exclusion wins; only an administrator override changes eligibility.
- **ICP definition edited while an assessment is running**: the assessment completes under the version it started with.
- **Evidence later removed or contradicted**: assessments already made keep the evidence they cited; a new assessment reflects the change.

## Requirements *(mandatory)*

### Functional Requirements

**Organisation import and duplicates**

- **FR-001**: The system MUST let an authorised operator import organisations from a CSV file with columns for name, aliases, web domains, organisation type, geography and notes.
- **FR-002**: The system MUST validate the whole file before saving anything and MUST present a per-row report stating the outcome (created, updated, unchanged, rejected, flagged for review) and a specific reason for every rejected or flagged row.
- **FR-003**: Valid rows MUST be saved even when other rows in the same file are rejected, and a rejected row MUST NOT leave partial data behind.
- **FR-004**: The system MUST detect likely duplicates by (a) exact match on normalised web domain (unless the domain is marked shared), which is always flagged, and (b) name or alias similarity above a configurable threshold, which is flagged only when the organisation type or the geography also matches. Name similarity alone MUST NOT create a merge candidate. All candidates are flagged for human review.
- **FR-005**: The system MUST NEVER merge accounts automatically. A merge MUST require an explicit decision by an authorised person with a recorded reason, MUST keep every name, domain, contact and note from both accounts, and MUST be audited.
- **FR-006**: A rejected merge candidate MUST be remembered so the same pair is not proposed again unless a matching attribute changes.
- **FR-007**: Re-importing an unchanged file MUST be idempotent: no account, alias, domain or contact is created or modified and every row reports "unchanged".
- **FR-008**: A domain MUST be markable as shared by several accounts, and a match on a shared domain alone MUST NOT create a merge candidate.
- **FR-009**: Renaming an organisation MUST keep its identity and retain every former name as an alias with the date it stopped being current.
- **FR-010**: Organisation type MUST come from a fixed list that includes at least: health information exchange, state or Medicaid program operator, health system, medtech, payer, multi-site practice, biotech and other.

**Contact import and lawful use**

- **FR-011**: The system MUST let an authorised operator import contacts from a CSV with name, title, department, business email, profile URL and account.
- **FR-012**: Every imported contact MUST carry a source (where the information came from) and a permitted-use basis (why it may be used). A row missing either MUST be rejected with that reason.
- **FR-013**: Contacts whose email uses a personal mailbox domain MUST be rejected as not a business email; the set of personal domains MUST be configurable.
- **FR-014**: A contact row MUST name an existing account; unknown accounts MUST be rejected, never guessed.
- **FR-015**: A contact MUST be identified by business email (and where absent by name plus account); importing a person already on file MUST NOT create a duplicate. When a row's title or account differs from the record on file, the row MUST be reported as a "conflict" and queued in the review queue (shared with merge candidates); the existing record MUST stay unchanged until an operator accepts or rejects the new values, and the decision MUST be audited.
- **FR-016**: One person MUST be able to have relationships with more than one account, each with its own title, roles and dates. Ending a relationship MUST record a date and reason and keep history.
- **FR-017**: Source and permitted-use basis MUST be viewable on the contact, and every change to them MUST be audited.
- **FR-018**: Imports of organisations and contacts MUST pass through the PHI boundary guard; a row that triggers it MUST be rejected without its content being stored, logged or echoed.

**ICP fit assessment**

- **FR-019**: The system MUST assess each organisation against ICP 1 (health information exchange or program operator) and ICP 2 (mid-size health system) and produce, per ICP, a status of strong, possible, weak, excluded or unknown.
- **FR-020**: Each assessment MUST list the criteria met, the criteria not met, the evidence supporting each, an overall confidence level, and the ICP definition version used.
- **FR-021**: Assessment MUST be deterministic rule evaluation: the same organisation data, evidence and definition version MUST always produce the same result. The rule result is authoritative.
- **FR-022**: The system MAY show an AI-generated fit suggestion beside the rule result. It MUST be labelled as AI-generated and advisory, MUST NOT alter or override the stored rule result, and its absence MUST NOT block assessment.
- **FR-023**: When an organisation lacks the information needed to judge, the status MUST be **unknown** and the missing information MUST be listed.
- **FR-024**: ICP fit MUST be stored and shown separately from intent: an assessment MUST NOT contain or depend on an intent score.
- **FR-025**: Every assessment MUST be kept as history; a later assessment adds a record and never rewrites an earlier one.
- **FR-026**: The system MUST assess the synthetic fixture organisations as follows: `helixbio` excluded; `northvale-hie` strong for ICP 1; `riverbend-health` strong or possible for ICP 2; `summitcare-health` possible for ICP 2 with "no demonstrated data problem" among the unmet criteria. Outcomes for the other fixtures are defined with the GTM lead at planning and MUST NOT be invented here.

**Exclusion and override**

- **FR-027**: Organisations of type medtech (hold), payer, multi-site practice or biotech MUST be assessed **excluded** and MUST NOT be eligible for the priority pipeline.
- **FR-028**: Only an administrator MUST be able to override an exclusion. An override MUST require a written rationale, MUST be stored as a new version recording who, when and why, and MUST leave the original exclusion visible.
- **FR-029**: An override MUST be revocable by an administrator, and a revocation MUST be a further version, never an edit of history.
- **FR-030**: Priority-pipeline eligibility MUST be a single, rule-based answer available to every later feature, derived from the fit status and any active override, never decided by an AI.

**Stakeholders and roles**

- **FR-031**: For each account relationship the system MUST store, separately, the contact's stated job title, their inferred stakeholder role, and the buyer-confirmed role and authority status.
- **FR-032**: Stakeholder roles MUST come from the fixed list: operational user, onboarding/data-quality lead, integration lead, data engineering lead, interoperability director, data operations director, data governance lead, privacy/compliance lead, CMIO, CDO, AI governance lead, CIO, CFO, executive director, state program director, procurement contact, economic buyer, champion, technical evaluator, unknown.
- **FR-033**: Setting a confirmed role of **economic buyer** MUST fail validation unless at least one linked evidence record is attached. The same rule MUST apply to any change that would mark an economic buyer as confirmed.
- **FR-034**: An inferred role MUST never be reported as confirmed by any view or rule; "is a buyer confirmed here" MUST be answerable only from confirmed roles.
- **FR-035**: Changes to inferred role, confirmed role, authority status or linked evidence MUST be audited with who and when.

**ICP definitions as versioned configuration**

- **FR-036**: ICP definitions (criteria, which are required, how each affects status) MUST be stored as versioned configuration. An edit MUST create a new, inactive version.
- **FR-037**: Only an administrator MUST be able to create or activate a version, activation MUST be an explicit separate step, and both MUST be audited. Earlier versions MUST remain viewable.
- **FR-038**: Each assessment MUST record, and keep, the definition version it was made under; activating a later version MUST NOT change existing assessments.
- **FR-039**: A definition that cannot be evaluated (for example no criteria) MUST be rejected on save and MUST NOT be activatable.
- **FR-040**: The "mid-size health system" criterion MUST be met when the account's recorded staffed bed count falls inside a configurable band (minimum and maximum, held in the ICP definition). Where no bed count is recorded, the criterion MUST rely on an analyst's recorded judgement that leads to **possible** rather than **strong** until a bed count is recorded. A bed count outside the band means the criterion is unmet.
- **FR-040a**: Operators and sales/service leads MUST be able to add or change an account's staffed bed count (also settable via organisation import when a bed count column is present). Each change MUST be audited with who and when, and MUST NOT trigger an assessment; a new assessment is a deliberate action and earlier assessments remain in history.

**Suppression**

- **FR-041**: Any signed-in user MUST be able to record suppression on a contact or on an account, with a reason. Suppression on an account MUST apply to every contact at it, including contacts added later.
- **FR-042**: Suppression MUST be effective immediately: the next eligibility check by any feature MUST reflect it, with no delay or batch.
- **FR-043**: Suppression MUST survive re-imports, merges, role changes and relationship endings, and MUST follow a person across all their accounts.
- **FR-044**: A single eligibility check MUST exist that returns "suppressed" (with scope and reason) or "not suppressed" for a contact, computed by rule and never by an AI, for use by every later feature.
- **FR-045**: Only an administrator MUST be able to lift a suppression, with a recorded reason; the suppression and its lifting MUST both stay in history.

**Cross-cutting**

- **FR-046**: Every state change in this feature (imports, merges, edits, role changes, overrides, definition versions, assessments, suppressions) MUST produce an audit event with actor, action, entity, before/after summary, time and correlation ID, per the foundation's audit rules.
- **FR-047**: Access MUST be permission-controlled: viewing accounts and contacts, importing, editing stakeholder data, administering ICP definitions and overrides MUST each map to permissions held by roles, and refusals MUST be audited. The role-to-permission mapping for this feature is a hypothesis recorded for confirmation.
- **FR-048**: The feature MUST announce, for later features to react to, that an account was created, a contact was identified, and an ICP fit was assessed, without including contact personal details beyond identifiers.
- **FR-049**: Contact personal data MUST be classified as business contact data. The system MUST support removal of a contact on request (administrator action, audited): all personal details (name, title, email, profile URL, notes) are erased, and only a suppression marker is kept, holding a one-way hash of the business email, the date and the reason. A later import of the same email MUST be blocked by that marker, and the audit event for the removal MUST NOT contain the erased details.
- **FR-050**: No requirement of this feature may involve patient information, credentials or other prohibited content; the system MUST NOT accept such content in any field of an import or edit.

### Key Entities *(include if feature involves data)*

- **Account**: A target organisation. Has a stable identity, a current name, former names as aliases (with dates), one or more web domains (each possibly marked shared), an organisation type, geography, notes, staffed bed count (optional number, with who recorded it and when), and a priority-eligibility state derived from fit and any override.
- **Merge candidate**: A proposed pairing of two accounts with the reason it was proposed (shared domain, name or alias similarity), its score, and its review state (open, merged, rejected) with who decided and why.
- **Contact**: A business person known to the GTM team. Has a name, business email, profile URL, source and permitted-use basis, and relationships to accounts. Classified as business contact data.
- **Account–contact relationship**: One person's link to one account: title as stated, department, inferred stakeholder role, buyer-confirmed role, authority status, linked evidence, start date, and end date and reason when they leave.
- **Stakeholder role**: One value from the fixed list of twenty roles.
- **Evidence reference**: A minimal record of why something is believed — what was observed or said, where (source or link), when, who recorded it, and its evidence status (for example observed or buyer-confirmed). Feature 003 builds the full evidence and signal model on this.
- **ICP definition**: A versioned rule set describing one ICP: its criteria, which are required, how each affects status, and its state (draft, active, retired).
- **ICP fit assessment**: One dated result for one account and one ICP: status, criteria met and unmet, evidence cited, confidence, definition version, and, if present, a labelled AI suggestion kept apart from the rule result.
- **Exclusion override**: A versioned administrator decision lifting an exclusion for one account, with rationale, who, when, and revocation state.
- **Suppression record**: A do-not-contact marker on a contact or an account, with scope, reason, who and when, and lifting history.
- **Import run**: One file import with its row-level outcomes and counts, used to prove idempotent re-imports.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For the synthetic fixtures, 100% of the stated outcomes hold: `helixbio` excluded; `northvale-hie` strong ICP 1; `riverbend-health` strong or possible ICP 2; `summitcare-health` possible ICP 2 with "no demonstrated data problem" listed as unmet.
- **SC-002**: Re-importing any previously imported file changes nothing: 0 records created or modified and every row reports "unchanged".
- **SC-003**: 0 accounts are ever merged without a recorded human decision, across all imports and test runs.
- **SC-004**: An operator can import a file of 500 organisations and read a complete validation report in under 5 minutes, and can find the reason for any rejected row without help.
- **SC-005**: 100% of contacts without a recorded source and permitted-use basis, and of contacts with personal-domain email, are rejected at import.
- **SC-006**: 100% of attempts to set economic buyer to confirmed without linked evidence fail with a clear message, and 0 inferred roles are ever reported as confirmed.
- **SC-007**: 0 excluded organisations are priority-eligible unless an administrator override with rationale is active; every override and revocation is attributable to a named administrator.
- **SC-008**: Running the same assessment twice on identical inputs gives identical results in 100% of cases, and every assessment shows its met and unmet criteria, evidence, confidence and definition version on one screen.
- **SC-009**: After a suppression is recorded, 100% of subsequent eligibility checks return "suppressed" with no delay, including after re-import, merge and relationship changes.
- **SC-010**: Activating a new ICP definition version leaves 100% of earlier assessments unchanged and viewable with their original version.
- **SC-011**: 100% of state changes in this feature and of refused actions produce an audit event; none contains content classified as prohibited.
- **SC-012**: A reviewer can resolve a merge candidate (approve or reject with a reason) in under 2 minutes, with both accounts' details side by side.

## Assumptions

- **Dependencies**: Builds on feature 001 (sign-in, roles, audit, PHI guard, background jobs, correlation IDs). It does not depend on features 003–013.
- **Evidence in this feature is minimal**: the full signal and evidence model belongs to feature 003. Here, an "evidence reference" is a small record (what, where, when, who, evidence status) that criteria and confirmed roles can cite. Feature 003 extends it without changing the rules in this feature.
- **Initial ICP definitions are hypotheses** (status `hypothesis`) agreed with the GTM lead (open question #1): ICP 1 requires an organisation type of health information exchange or state/Medicaid program operator plus evidence of sender onboarding or implementation-guide change friction; ICP 2 requires a health-system type in the configured size band, plus evidence of a stalled data-dependent AI or analytics pilot and a demonstrated data problem. Excluded types are those named in FR-027. Exact criteria wording is finalised at planning.
- **Status meaning** (hypothesis, configurable; first rule that applies wins, made unambiguous 2026-11-16 for the first version): **excluded** = excluded organisation type; **unknown** = organisation type is `unknown`, or the type matches the ICP but there is no recorded evidence and no recorded size or judgement at all; **weak** = organisation type is known and not excluded but is not a type the ICP targets; **strong** = type matches and every required criterion is met on observed or buyer-confirmed evidence; **possible** = type matches and anything else (one or more required criteria unmet, only inferred, or only analyst judgement). To be revisited with the GTM lead (open question #28).
- **Confidence** is derived from the evidence status behind the met criteria: high when met criteria rest on observed or buyer-confirmed evidence, medium when partly inferred, low when mostly assumed.
- **"Mid-size"** is measured by staffed bed count within a configurable band (clarified 2026-11-16; open question #2 still needs the actual band values from the GTM lead). Until a bed count is recorded, analyst judgement yields **possible**.
- **Allowed contact sources** (open question #13: no enrichment provider in the MVP): manual operator import with a documented origin, first-party form submission, public business directory or organisation website, referral or introduction, and customer-supplied list. **Permitted-use basis** values: business-to-business legitimate interest, consent given, existing relationship, and service-related. Both lists are configurable and need confirmation by legal counsel and the privacy lead (open question #10).
- **Suppression scope** (to confirm): contact and account scopes are in this feature. Suppression of an entire email domain is not offered here because of shared domains; a suppressed person is identified by their business email.
- **Duplicate matching defaults** (hypotheses, configurable; name rule clarified 2026-11-16): exact normalised-domain match always proposes a candidate unless the domain is marked shared; name or alias similarity proposes a candidate only above a configurable threshold and only when organisation type or geography also matches; a person is the same contact when business email matches.
- **Permissions** (hypothesis for confirmation, extends open question #27): operators can import and edit accounts and contacts; sales/service leads can edit stakeholder roles and link evidence; administrators alone can lift suppressions, override exclusions and manage ICP definitions; any signed-in user can add a suppression and view accounts and contacts they are permitted to see.
- **Scale**: tens to low thousands of accounts and contacts; files of up to a few thousand rows.
- **Out of scope**: research automation and hypotheses (004), signals and full evidence handling (003), offer routing (006), outreach and consent management beyond recording suppression (009), CRM synchronisation (open question #15), and contact enrichment from any provider (open question #13).
- **Data boundary**: only non-PHI business data is held; names and titles of business contacts are business-contact data; no patient or credential data is accepted in any field.
