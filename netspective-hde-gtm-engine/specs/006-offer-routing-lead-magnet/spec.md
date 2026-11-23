# Feature Specification: Offer Routing and Lead Magnet

**Feature Branch**: `006-offer-routing-lead-magnet`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Offer Recommendation, Routing rules, Offer 5 lead-magnet capture and Offer 1/6 intake forms (read docs/context/00-source-prompt.md §§6, 13, 18.1, 18.2, 23.3, 36 Example C and docs/context/04-acceptance-scenarios.md Scenarios C, G)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An explained offer recommendation from versioned routing rules (Priority: P1)

A GTM operator opens an account (and, where there is one, a contact) and gets an offer recommendation: Offer 1, Offer 6, Offer 5, another approved offer, further research, or no action. The recommendation combines the ICP fit, the account's hypotheses and how strong their evidence is, the contact's buyer role, the buyer effort the offer asks for, the offer's capacity and availability, prior interactions and the contact's communication permission. It states why, and what it could not take into account. The offers that may be recommended are decided first, by fixed rules, before any language model is involved; a language model may only explain or order the offers that remain.

**Why this priority**: This is the point of the whole engine: turning evidence into one defensible next offer. Every later feature (workshops, qualification, content) starts from an accepted recommendation, and the safety rules (suppression, consent, exclusion, capacity) must hold here first.

**Independent Test**: With the synthetic organisations, ask for a recommendation for each, then change one input at a time (suppress the contact, remove consent, exclude the ICP, fill the offer's capacity, weaken the hypothesis) and confirm the outcome changes as the rules say, with the rule set version on every result.

**Acceptance Scenarios**:

1. **Given** an ICP 1 account with a supported sender-onboarding-friction hypothesis, **When** the operator asks for a recommendation, **Then** the recommendation is Offer 1, with an explanation naming the rule, the evidence behind the hypothesis and the limitations.
2. **Given** an ICP 2 account with a supported stalled-pilot or unclear-input-provenance hypothesis, **When** the operator asks for a recommendation, **Then** the recommendation is Offer 6.
3. **Given** an account of either ICP with unresolved CCDA-to-FHIR mapping decisions, **When** the operator asks for a recommendation, **Then** Offer 5 is eligible and is recommended unless a stronger rule applies.
4. **Given** an account with a multi-format gap in at least two categories, **When** the operator asks for a recommendation, **Then** the recommendation is Offer 1 for ICP 1 and Offer 6 for ICP 2.
5. **Given** an account whose hypothesis is weak, unsupported, rejected or stale, **When** the operator asks for a recommendation, **Then** the outcome is further research or no action, and it never proposes an automatic email.
6. **Given** a contact who is suppressed, who has no permission to be contacted, or an account whose ICP fit is excluded, **When** the operator asks for a recommendation, **Then** no outreach is recommended, the reason is named, and no language model output can change that.
7. **Given** any recommendation, **When** it is shown, **Then** it carries the routing rule set version it was made with, its explanation and its limitations, and an operator can accept it, dismiss it or ask for a new one once inputs change.
8. **Given** the same inputs and the same rule set version, **When** a recommendation is asked for twice, **Then** the set of eligible offers and the rules that matched are identical both times.

---

### User Story 2 - Offer 5 lead magnet: gated download and routed follow-up (Priority: P1)

A prospect asks for the CCDA-to-FHIR Mapping Decision Register on a short form: work email, role, organisation type, a privacy notice they have seen, and an optional consent to be contacted. The register is delivered. The system finds or creates the account and contact, records the download as first-party engagement (it shows interest in the topic, not buying intent and never a qualified lead), checks ICP fit, applies the routing rules (ICP 1 leads to an Offer 1 follow-up, ICP 2 to an Offer 6 follow-up) and queues a follow-up recommendation for a person to review. Nothing is sent automatically.

**Why this priority**: It is the only prospect-facing entry point in this feature and the canonical acceptance scenario (C). It also exercises consent, ICP fit and routing together.

**Independent Test**: Submit the form for a synthetic ICP 1 organisation and a synthetic ICP 2 organisation, then confirm the account and contact exist, the download is recorded as engagement, a follow-up recommendation is waiting in the review queue, and no message was sent.

**Acceptance Scenarios**:

1. **Given** a visitor on the form, **When** they submit a work email, role, organisation type and have seen the notice, **Then** they receive the register, a download record is stored with the notice version shown and their consent choice, and the page shows a plain confirmation.
2. **Given** a download from an organisation that does not yet exist, **When** the form is submitted, **Then** an account and a contact are created with the source recorded as the first-party form, and the same person downloading again reuses the same records.
3. **Given** a download, **When** it is recorded, **Then** it is labelled first-party engagement and never counted as buying intent or as a qualified lead (Offer 5 is never an SQL).
4. **Given** a download by an ICP 1 contact who agreed to be contacted, **When** routing runs, **Then** a follow-up recommendation for Offer 1 is queued for human review; for ICP 2 it is Offer 6; for fit that is unknown, weak or excluded it is research or no action.
5. **Given** a download where the person did not agree to be contacted, **When** routing runs, **Then** the register is still delivered and the download is recorded, but no outreach is recommended and the recommendation says why.
6. **Given** a personal email address (a free consumer mailbox), **When** the form is submitted, **Then** the download is accepted and the register delivered, the submission is flagged as a personal email, and no business account or contact is created from it until a person reviews it.
7. **Given** a contact who was unsubscribed or suppressed earlier, **When** they download the register, **Then** the download is recorded and the register delivered, but no follow-up is ever recommended.
8. **Given** a submission that contains patient-like data in any field, **When** it is submitted, **Then** it is refused whole with a plain message, nothing is stored or logged from it and the operator is notified.
9. **Given** automated or abusive submissions, **When** they arrive, **Then** they are rejected or throttled without creating accounts, contacts or recommendations.

---

### User Story 3 - Capacity exhausted: not recommended, with alternatives and a wait-list (Priority: P2)

When an offer is full for the period (for example Offer 6 for the month), it is not recommended. The operator sees why, the alternatives (a wait-list place, Offer 5, further research, or doing nothing) with an explanation, and can add the account and contact to a wait-list for that offer.

**Why this priority**: Scenario G. Capacity is a first-class constraint, but it only matters once recommendations exist.

**Independent Test**: Fill Offer 6 for the month, ask for a recommendation for an ICP 2 account that would otherwise get Offer 6, and confirm the alternatives and the wait-list option appear; free a place and confirm Offer 6 is recommended again.

**Acceptance Scenarios**:

1. **Given** Offer 6 is full for the current month, **When** the operator asks for a recommendation for an ICP 2 account with a supported stalled-pilot hypothesis, **Then** Offer 6 is not recommended, and the alternatives (wait-list, Offer 5, research, do nothing) are listed with a reason for each.
2. **Given** the capacity answer says "no limit set", **When** a recommendation is made, **Then** the offer is not treated as having unlimited room: the recommendation says so in its limitations.
3. **Given** the operator chooses the wait-list, **When** they confirm, **Then** the account and contact are recorded on that offer's wait-list with who, when and why, and nothing is sent.
4. **Given** places become available, **When** the operator views the wait-list, **Then** waiting entries are shown oldest first for review, and none is contacted automatically.

---

### User Story 4 - Request a 30-minute working session (Priority: P2)

On the Offer 5 page a prospect can instead ask for a 30-minute working session, bringing up to five open mapping decisions. The request lands in a request inbox for an operator to review, with the same consent, notice and personal-email handling as the download.

**Why this priority**: It is the secondary call to action and a distinct conversion step; download-to-session must be measurable separately.

**Independent Test**: Submit a session request with five open decisions, and one with a sixth decision or patient-like text, and confirm the first is queued for review and the others are refused.

**Acceptance Scenarios**:

1. **Given** a prospect on the form, **When** they submit contact details and up to five open decisions, **Then** a session request is recorded and queued for human review, separate from any download record.
2. **Given** a request with more than five decisions or an over-long decision, **When** it is submitted, **Then** it is refused with a plain message.
3. **Given** a request that contains patient-like data, **When** it is submitted, **Then** it is refused whole and nothing is stored.
4. **Given** a session request, **When** the operator reviews it, **Then** they can link it to the account and contact, and the download and session request remain separate records so that conversion between them can be measured.

---

### User Story 5 - Offer 1 intake form: a short, non-PHI intake (Priority: P2)

A prospect or an operator (on a call) completes the Offer 1 intake in about ten minutes: organisation or program type, one recent sender onboarding, the format and implementation guide in use, the timeline and stages, known delays and rejections, the roles who will attend, and whether non-PHI specifications or scrubbed rejection logs are available. The form never asks for PHI, production data, credentials or budget.

**Why this priority**: It prepares the Friction Map session and keeps the data boundary visible at the point of capture.

**Independent Test**: Submit a complete, clean Offer 1 intake, then variants containing a patient-like value, a credential, and a budget question or answer, and confirm only the clean one is accepted.

**Acceptance Scenarios**:

1. **Given** a complete intake, **When** it is submitted, **Then** it is stored against the account and contact, labelled as non-PHI, and queued for review.
2. **Given** an intake with a missing required item, **When** it is submitted, **Then** it is refused with the missing items named.
3. **Given** an intake whose text includes patient-like patterns, production data or credentials, **When** it is submitted, **Then** it is refused whole and nothing is stored or logged.
4. **Given** the form, **When** it is displayed, **Then** it contains no budget, price or funding questions.
5. **Given** an intake, **When** it is shown to an operator, **Then** non-PHI specifications and scrubbed rejection logs appear only as an "available" answer or a reference, never as uploaded content.

---

### User Story 6 - Offer 6 intake form: ten field names, never values (Priority: P2)

An ICP 2 prospect or an operator completes the Offer 6 intake: the named use case, the pilot owner, source-system names, exactly ten field names, the data or integration lead, known field-quality concerns, interface or message types, and the attendees. Field values are rejected.

**Why this priority**: The Pilot Input Trace Workshop depends on field names; accepting values would breach the data boundary.

**Independent Test**: Submit a clean intake with ten field names, then one where a "field" is a sample value (a date of birth, a name with a number, a record row), and confirm the second is blocked.

**Acceptance Scenarios**:

1. **Given** an intake with a use case, pilot owner, source systems, ten field names and attendees, **When** it is submitted, **Then** it is stored and queued for review.
2. **Given** an intake with fewer or more than ten field names, **When** it is submitted, **Then** it is refused with a plain message.
3. **Given** an intake where an entry is a sample value or sample patient data, **When** it is submitted, **Then** it is blocked by the PHI boundary check, nothing is stored or logged, and the operator is notified.
4. **Given** an entry that is not a field name (for example a sentence, an email address or a long number), **When** it is submitted, **Then** it is refused with a message that explains field names are needed, not values.
5. **Given** the form, **When** it is displayed, **Then** it asks for no credentials, production data or budget.

---

### Edge Cases

- A contact has an account-level suppression but the download arrives from a different email at the same organisation: the new contact at a suppressed account is treated as suppressed for follow-up, while the register is still delivered.
- The same person downloads twice, or submits the same form twice in a minute: one account, one contact, two download records at most, and a double submit does not create two recommendations.
- The domain of a work email matches an existing account but the organisation type given differs: the account is reused, the difference is flagged for review, and ICP fit is recalculated by rule.
- A download for an organisation whose type falls under an excluded ICP (for example biotech): the register is delivered, the download is recorded, and no outreach is recommended.
- Several routing rules match: the result lists every matching rule, the order of precedence applied, and why the first was chosen.
- Evidence behind a hypothesis changes after a recommendation was made (a signal is rejected or goes stale): the recommendation shows as out of date and is recalculated when asked.
- An offer is withdrawn, expired or still a draft: it is never recommended, and the explanation says it is unavailable.
- The register file cannot be delivered: the person sees a plain message to try again, the download is recorded as failed delivery, and no follow-up is queued until a person reviews it.
- A visitor returns after the 24-hour link has expired: they can ask for a fresh link, which is recorded as a new download, and the earlier record stays unchanged.
- A form is submitted while the PHI guard is unavailable: the submission is refused rather than accepted unchecked.
- An operator accepts a recommendation for an offer that has just become full: the acceptance is refused and the capacity answer is shown.
- A person withdraws consent after a download: later recommendations for them recommend no outreach.

## Requirements *(mandatory)*

### Functional Requirements

**Recommendation and eligibility**

- **FR-001**: The system MUST produce an offer recommendation for an account, and for a contact at that account where one is given, whose outcome is one of: Offer 1, Offer 6, Offer 5, another approved offer, further research, or no action.
- **FR-002**: A recommendation MUST take into account the ICP fit, the account's hypotheses and the strength of their evidence, the contact's buyer role, the buyer effort the offer asks for, the offer's capacity, the offer's availability, prior interactions and the contact's communication permission.
- **FR-003**: A recommendation MUST state its explanation, the evidence it relied on and its limitations (including inputs that were unknown), and MUST record the routing rule set version it was made with.
- **FR-004**: Eligibility MUST be decided by fixed rules before any language model is used: a suppressed contact or account, a missing communication permission, an excluded ICP fit, an offer that is full, and an offer that is not available (draft, withdrawn or expired) MUST each remove the offer or the outreach from the eligible set. A language model MAY only explain or order the offers that remain and MUST NOT add or restore an offer.
- **FR-005**: When no offer is eligible, or the hypothesis is weak, unsupported, rejected or stale, the outcome MUST be further research or no action, with the reason, and the recommendation MUST NOT propose an automatic email.
- **FR-006**: Given the same inputs and the same rule set version, the eligible offers and the matching rules MUST be identical on every run.
- **FR-007**: A recommendation MUST be accepted or dismissed by a person, with a reason on dismissal. Accepting one MUST NOT send anything; sending belongs to a later feature.
- **FR-008**: A recommendation MUST show as out of date when its inputs have changed (a signal, hypothesis, fit, capacity, suppression or consent), and a new one MUST be made on request without altering the earlier one.

**Routing rules**

- **FR-009**: Routing rules MUST be held as a versioned, configurable rule set. A change MUST create a new version with its author and reason, and earlier versions MUST stay readable. A new version is activated by one person who holds the right to manage routing rules (service lead or administrator), with a recorded reason, and only when all rule tests pass (FR-013); activation is a policy change and is audited.
- **FR-010**: The first rule set MUST contain: ICP 1 with a supported sender-onboarding-friction hypothesis leads to Offer 1; ICP 2 with a supported stalled-pilot or unclear-input-provenance hypothesis leads to Offer 6; either ICP with unresolved CCDA-to-FHIR decisions leads to Offer 5; a download of the Offer 5 register by ICP 1 leads to an Offer 1 follow-up and by ICP 2 to an Offer 6 follow-up; a multi-format gap in at least two categories leads to Offer 1 or Offer 6 by ICP; a weak or unsupported hypothesis leads to research or no action.
- **FR-011**: When several rules match, the system MUST apply a fixed order of precedence, list every matching rule, and say why the chosen one won.
- **FR-012**: A hypothesis MUST count as "supported" only when it is accepted, is not rejected, weakening or stale, and is either strengthening or validated, or untested with at least one current approved supporting signal and a confidence of medium or higher. Every other hypothesis is "weak". The definition and thresholds MUST be configurable and labelled hypotheses.
- **FR-013**: Every routing rule MUST have table-driven tests covering its match, its near-misses and its precedence, and a rule set MUST NOT be activated unless these tests pass.

**Capacity and wait-list**

- **FR-014**: An offer that is full for the period MUST NOT be recommended. The recommendation MUST list the alternatives (wait-list, Offer 5, further research, do nothing) with a reason for each. An offer with no limit set MUST NOT be treated as unlimited, and the limitation MUST be stated.
- **FR-015**: An operator MUST be able to add an account and contact to an offer's wait-list with a reason; entries MUST be listed oldest first for review and MUST NOT trigger any contact.

**Offer 5 lead magnet**

- **FR-016**: The system MUST provide a gated form for the CCDA-to-FHIR Mapping Decision Register that collects work email, role, organisation type, shows a privacy notice and captures an optional consent to be contacted. Consent MUST NOT be a condition of receiving the register. Each form MUST be available as a minimal hosted page and as a submission endpoint that Netspective's existing site can call from an allowed list of sites.
- **FR-017**: A download MUST record the notice version shown, the wording of the consent given, the time, and the person's choice, and MUST be kept as a consent record. Notice and consent wording is versioned, and a version MUST be approved by the marketing approver before any form shows it; a form MUST NOT show an unapproved version.
- **FR-018**: A download MUST find or create the account and contact (with the source recorded as the first-party form), record a download as first-party engagement, run the ICP fit check and routing, and queue a follow-up recommendation for human review. A download MUST NOT be treated as buying intent, a qualified lead or evidence of a problem.
- **FR-019**: A personal (free consumer) email address MUST be accepted for the download and flagged. No business account or contact MUST be created from it until a person reviews it. The list of personal email domains MUST be the configurable list already used for contacts.
- **FR-020**: The register MUST be delivered as a download link shown on the confirmation page, valid for 24 hours (a hypothesis, configurable); no email is sent. A visitor whose link has expired MUST be able to ask for a fresh one, which is a new download record. A failed delivery MUST be recorded and shown to the person in plain words.
- **FR-021**: Follow-up MUST respect communication permission: with no consent, or for a suppressed or unsubscribed contact or account, the download is recorded and the register delivered but no outreach is recommended.
- **FR-022**: A repeated submission by the same person MUST reuse the same account and contact and MUST NOT create duplicate recommendations.
- **FR-023**: The download record and the session request record MUST be distinct, so that download-to-session conversion can be measured separately from any other measure.

**Working session request**

- **FR-024**: The Offer 5 page MUST offer a request for a 30-minute working session in which the person lists at most five open decisions, each of limited length, with the same notice, consent and personal-email handling as the download. A request MUST be queued for human review and MUST NOT send anything.

**Intake forms**

- **FR-025**: The Offer 1 intake MUST collect: organisation or program type, one recent sender onboarding, format and implementation guide, timeline and stages, known delays and rejections, attending roles, and whether non-PHI specifications or scrubbed rejection logs are available. It MUST be completable in about ten minutes and MUST NOT ask for PHI, production data, credentials, or anything about budget or price.
- **FR-026**: The Offer 6 intake MUST collect: the named use case, pilot owner, source-system names, exactly ten field names, the data or integration lead, known field-quality concerns, interface or message types, and attendees. Field values MUST be rejected: an entry must read as a field name, and an entry that looks like a value (a date, a name, a long number, an email address, a sentence or a record row) MUST be refused with a plain message.
- **FR-027**: Intake submissions MUST be stored as typed records against the account and contact, labelled non-PHI, and queued for human review. Non-PHI specifications and scrubbed rejection logs MUST be recorded only as an "available" answer or a reference, never as uploaded content.

**Data boundary, abuse and access**

- **FR-028**: Every free-text field of every form MUST pass the PHI boundary check before anything is stored. A submission containing patient-like data MUST be refused whole, nothing from it MUST be stored, logged or sent to a language model, the operator MUST be notified and an audit event MUST record the refusal without the content.
- **FR-029**: Public forms MUST resist automated abuse (rate limiting, a hidden-field check, a minimum time to submit) without relying on solving a puzzle, MUST accept submissions only from the allowed sites, and MUST refuse oversized or malformed submissions.
- **FR-030**: Operators MUST be able to see recommendations on the account workspace and a request inbox of downloads, session requests, intake submissions and wait-list entries, each with its review state.
- **FR-031**: Access MUST be permission-controlled: viewing and acting on recommendations and the request inbox, and changing routing rules, MUST each map to permissions held by roles; refusals MUST be audited. The role mapping for this feature is a hypothesis recorded for confirmation.
- **FR-032**: Every create, change, acceptance, dismissal, consent and rule set change MUST be recorded in the audit trail with who, what, when and why, and MUST publish a change notice carrying identifiers only (recommendation made, request received, lead magnet downloaded).
- **FR-033**: A recommendation, a request or an intake MUST NOT store credentials, patient-level data, or any pricing or budget statement.

### Key Entities

- **OfferRecommendation**: An outcome for an account and optionally a contact, with the offers considered, the eligible set, the rules that matched, the chosen outcome, the explanation, the limitations, the routing rule set version and its review state.
- **RoutingRuleSet**: A versioned, configurable set of routing rules with precedence, an author, a reason and an activation state.
- **OfferRequest**: A prospect's request: a register download, a working session, or an Offer 1 or Offer 6 session, with its review state and flags (for example personal email).
- **IntakeSubmission**: A typed Offer 1 or Offer 6 intake, labelled non-PHI, linked to an account and contact.
- **ConsentRecord**: The notice version shown, the consent wording and choice, the time and the person.
- **NoticeVersion**: A version of the privacy notice and consent wording, with its approver and approval time; only an approved version can be shown.
- **LeadMagnetDownload**: A recorded download of the register, as first-party engagement, with delivery result.
- **WaitListEntry**: An account and contact waiting for an offer, with the reason, who added it and when.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of recommendations carry an explanation, limitations and the routing rule set version.
- **SC-002**: In the acceptance test set, 0 recommendations propose outreach to a suppressed or unsubscribed contact, to a contact with no communication permission, to an excluded ICP, or for an offer that is full or unavailable.
- **SC-003**: Acceptance Scenario C (Offer 5 lead magnet) and Scenario G (capacity) pass end to end on the synthetic organisations.
- **SC-004**: 100% of personal-email downloads in the test set are accepted and flagged, and none creates a business account or contact without review.
- **SC-005**: 100% of Offer 6 intakes containing sample patient values in the test corpus are blocked, with nothing stored or logged, and 100% of clean ten-field intakes are accepted.
- **SC-006**: Repeating a recommendation with the same inputs and rule set version gives the same eligible set and matching rules in 100% of test cases.
- **SC-007**: A visitor can complete the download form and reach the register in under two minutes, and an Offer 1 intake can be completed in about ten minutes.
- **SC-008**: Every rule in the first rule set has tests for its match, near-miss and precedence, and a rule set with a failing test cannot be activated.
- **SC-009**: Download-to-session conversion can be read from the records without any manual matching, because the two steps are separate records.

## Clarifications

### Session 2026-11-23

- Q: Where are the public forms hosted? → A: Each form is a minimal hosted page and also a submission endpoint the existing site can call from an allowed list of sites (open question 18 default); the website itself is not built here.
- Q: How does the register reach the visitor, given email sending is out of scope? → A: As a download link on the confirmation page, valid for 24 hours (a hypothesis); a visitor can ask for a fresh link; no email.
- Q: When is a hypothesis "supported" enough to route on? → A: Accepted, not rejected, weakening or stale, and either strengthening or validated, or untested with at least one current approved supporting signal and confidence of medium or higher; every other hypothesis is weak.
- Q: Who may activate a new routing rule set? → A: One person who holds the routing-rules right (service lead or administrator), with a recorded reason, and only when every rule test passes.
- Q: Who owns the notice and consent wording? → A: The marketing approver approves each wording version before any form shows it; each download records the version shown.

## Assumptions

- The business source sections the description cites (6, 13, 18.1, 18.2, 23.3 and 36 Example C) are not in the repository. This specification is built from the description, the runbook's Feature 006 entry, the guardrails, the glossary and acceptance scenarios C and G; every rule, threshold and form field not stated there is a labelled hypothesis, and the gap is recorded as an open question.
- The two ICPs, the five ICP fit statuses, suppression, the personal email domain list and contact sources come from feature 002; hypotheses, their states and evidence strength from feature 004; offers, their status, capacity and the capacity answer from feature 005. Offers 1, 5 and 6 are in force (approved) but still have attributes to be provided; an offer is recommendable when it is in force and not withdrawn or expired.
- Consent belongs to the person's own choice at the form and is recorded here as a consent record. Wider email permission rules (jurisdictions, unsubscribe handling) belong to feature 009; this feature only honours suppression and recorded consent.
- The register file itself (its content and format) is supplied by the business and is not in the repository; this feature stores a reference to it and delivers it, and the file content is an open input.
- A personal email address is a flagged submission, not a business contact: contacts remain business contacts, as in feature 002.
- The wait-list is a simple recorded list for review; contacting people on it, and booking sessions, belong to features 009 and 007.
- Intake submissions are reviewed by a person; workshop scheduling, findings and qualification are separate features.
- All thresholds (what counts as a supported hypothesis, the minimum evidence strength, rule precedence) are hypotheses, configurable and recorded for confirmation. Capacity numbers come from feature 005 and are hypotheses.
- A website build, email sending, workshop operations, qualification and next-best-action are out of scope; this feature provides the forms' back end and minimal hosted pages.
