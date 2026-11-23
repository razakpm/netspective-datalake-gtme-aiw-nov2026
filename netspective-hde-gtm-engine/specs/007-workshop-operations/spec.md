# Feature Specification: Workshop Operations

**Feature Branch**: `007-workshop-operations`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Workshop Operations for Offer 1 (Sender Onboarding Friction Map) and Offer 6 (Pilot Input Trace Workshop) (read docs/context/00-source-prompt.md §§6, 18, 22.4 and Scenarios A, B, D)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Turn an approved request into a workshop and follow it through its lifecycle (Priority: P1)

A GTM operator takes a request that a person has already reviewed and linked to an account and contact (from feature 006) and converts it into a workshop for Offer 1 (the 45-minute Sender Onboarding Friction Map) or Offer 6 (the 90-minute Pilot Input Trace Workshop). The workshop moves through requested, booked, held, findings recorded and closed, and can instead be cancelled, marked as a no-show, or rescheduled. The operator books it by hand, or through a calendar provider when one is configured; either way the booking is recorded the same way.

**Why this priority**: Everything else in this feature hangs off a workshop. Without a controlled lifecycle there is nothing to prepare for, record findings against, or measure.

**Independent Test**: Convert a linked Offer 1 intake request and a linked Offer 6 intake request into workshops; book one by hand and one through the fake calendar provider; hold both; then confirm each state change was allowed only along the permitted path and is audited.

**Acceptance Scenarios**:

1. **Given** a request that is linked to an account and contact and carries an Offer 1 or Offer 6 intake, **When** the operator converts it, **Then** a workshop for that offer exists in the `requested` state, linked to the request, account, contact and intake, and nothing is sent to anyone.
2. **Given** a request that has not been reviewed and linked, that belongs to an offer other than Offer 1 or 6, or that already has an open workshop, **When** the operator tries to convert it, **Then** the conversion is refused with the reason.
3. **Given** a workshop in `requested`, **When** the operator books it with a date and time (by hand or through the calendar provider), **Then** it moves to `booked`, the booking is recorded, and the offer's session length (45 or 90 minutes) is shown.
4. **Given** a booked workshop, **When** it takes place, **Then** the operator marks it `held`; when findings are finalised it moves to `findings recorded`; when the operator closes it, it moves to `closed`.
5. **Given** a booked workshop, **When** the buyer does not attend, **Then** the operator marks it `no show` with a note, and it cannot later be marked held.
6. **Given** a requested or booked workshop, **When** it is cancelled, **Then** it becomes `cancelled`, with a reason, and no further change is allowed.
7. **Given** a booked workshop, **When** it is rescheduled to a new date, **Then** it stays booked with the new date, and the history shows each earlier date and who changed it.
8. **Given** any change of state, **When** it is made, **Then** it is by a person, with a note where the rules require one, and is audited with who, when and why; a move that is not on the permitted path is refused and the refusal is audited.

---

### User Story 2 - Booking uses the offer's capacity and cancelling gives it back (Priority: P1)

Every booked workshop takes one place from its offer's capacity (feature 005). Cancelling releases the place. A booking for an offer that is full is refused, and the operator is shown why and what the alternatives are.

**Why this priority**: Capacity is a first-class constraint (Scenario G); a workshop that quietly exceeds an offer's limit would undo it.

**Independent Test**: Fill Offer 6's capacity for the month, try to book a further Offer 6 workshop and confirm it is refused; cancel one booked workshop and confirm the same booking now succeeds.

**Acceptance Scenarios**:

1. **Given** an offer with room, **When** a workshop is booked, **Then** exactly one session is counted against that offer for the period containing the session date.
2. **Given** a full offer, **When** a workshop is booked, **Then** the booking is refused with the capacity answer, the workshop stays in `requested`, and the operator can add the account to the wait-list.
3. **Given** a booked workshop, **When** it is cancelled, **Then** its place is released at once, and a later booking for that offer can use it.
4. **Given** a booked workshop that is rescheduled into a different period, **When** the new date falls in a full period, **Then** the change is refused and the original booking is unchanged.
5. **Given** a workshop that is held or marked no-show, **When** capacity is read, **Then** it still counts as used (as feature 005 defines), and a cancelled one does not.
6. **Given** an offer with no limit set, **When** a workshop is booked, **Then** it is allowed and the answer still says that no limit is set, never that room is unlimited.

---

### User Story 3 - The delivering engineer gets a preparation brief (Priority: P2)

Before the session, the delivering engineer opens a preparation brief for the workshop. It is drafted from the buyer's intake and the evidence already held about the account. It separates what is confirmed from what is inferred and what is unknown, suggests questions to ask, and lists the non-PHI artifacts worth asking for. The brief is advice: a person reads it, can regenerate it, and nothing in it is treated as fact.

**Why this priority**: It saves preparation time and keeps the session on evidence. It is assistive, so the lifecycle and findings work without it.

**Independent Test**: Generate a brief for `northvale-hie` (Offer 1) and `riverbend-health` (Offer 6); confirm each lists confirmed facts with their evidence, inferences labelled as such, unknowns, suggested questions and an artifact checklist, and that a brief naming a fact the account does not hold is rejected.

**Acceptance Scenarios**:

1. **Given** a booked workshop with an intake and an account with evidence, **When** the engineer asks for a brief, **Then** the brief lists confirmed facts (each tied to its evidence), inferences (labelled as inferences), unknowns, suggested questions and a non-PHI artifact checklist, and records which model and prompt version drafted it.
2. **Given** an account with little evidence, **When** a brief is made, **Then** the gaps appear as unknowns rather than being filled in.
3. **Given** the model returns something that does not fit the brief's structure, or states a fact with no supporting evidence, **When** it is checked, **Then** it is refused or the unsupported item is dropped, and the engineer sees a plain message.
4. **Given** the intake or the evidence contains text that tries to give the model instructions, **When** a brief is made, **Then** that text is treated as data and has no effect on the brief, the workshop or any other record.
5. **Given** the artifact checklist, **When** it is shown, **Then** it names only field names, source-system names, specifications, timelines and scrubbed rejection logs, never patient data, production data or credentials.
6. **Given** the operator asks for a new brief, **When** it is made, **Then** the earlier brief stays readable and is shown as superseded.
7. **Given** a model is unavailable or the cost cap would be exceeded, **When** a brief is asked for, **Then** the workshop is unaffected and the engineer sees a plain message, with a simple checklist-only brief available.

---

### User Story 4 - Record non-PHI artifacts safely (Priority: P1)

The operator or the buyer's contact records the artifacts that will be used in the session: specifications, timelines, scrubbed rejection logs, and similar. An artifact is recorded as metadata and a reference (what it is, where it is, who supplied it, when) and, where a file is supplied, the file is checked before it is kept. A file that looks as if it holds PHI is not kept for use: it is held for a reviewer, never shown to a model or written to a log, and the operator is told.

**Why this priority**: This is the data boundary (Scenario D). Workshops are where outsiders are most likely to hand over something they should not.

**Independent Test**: Record a clean specification reference and a clean scrubbed log; then try to record an artifact for `granite-health` whose content holds an MRN with a name, a DOB with a name, an SSN and patient rows; confirm each is held, none reaches a model or a log, the operator is alerted, and an audit event records it without the content.

**Acceptance Scenarios**:

1. **Given** a workshop, **When** a reference to a specification, a timeline or a scrubbed rejection log is recorded, **Then** the artifact is stored as metadata (kind, title, source, who supplied it, when, classification `non-PHI`) and appears on the workshop's checklist as received.
2. **Given** a file is supplied, **When** it is checked and passes, **Then** it is kept in file storage and its reference is recorded; the content is never copied into any record that people read in bulk or into any log.
3. **Given** a file or note that contains PHI-like patterns, **When** it is checked, **Then** it is not kept for use, it is held for a reviewer, the operator is alerted, an audit event records the refusal without the content, and nothing is sent to a model.
4. **Given** a held artifact, **When** a reviewer with the right permission releases or discards it with a reason, **Then** the decision is audited; a released one is rechecked before it becomes usable.
5. **Given** an artifact title or note that contains patient-like text, **When** it is recorded, **Then** the whole entry is refused and nothing is stored.
6. **Given** an artifact kind that is not on the allowed list (for example "patient extract" or "credentials"), **When** it is recorded, **Then** it is refused with the reason.
7. **Given** the guard is unavailable, **When** an artifact is recorded, **Then** it is refused rather than accepted unchecked.

---

### User Story 5 - Offer 1 findings: three delay sources and who can fix each (Priority: P1)

After an Offer 1 session the operator records the findings: a summary of the onboarding flow, the three biggest delay sources, each classified as addressable by the operator of the exchange, by the sender, or by the rule owner, with the delay quantified or marked "not quantified", the unknowns, a suggested next step and an explicit note on the boundary between this free diagnosis and any paid work. The buyer's confirmation of each delay and its owner is recorded as confirmed or not confirmed.

**Why this priority**: These findings are the product of the free session and the evidence on which later scoping depends (Scenario A).

**Independent Test**: Record Offer 1 findings with three classified delay sources, finalise them, and confirm the workshop moves to findings recorded; then try with two sources, with four, with an unclassified source, and without the boundary note, and confirm each is refused unless the permitted reason is recorded.

**Acceptance Scenarios**:

1. **Given** a held Offer 1 workshop, **When** the operator records a flow summary, exactly three delay sources (each with a description, an owner class of operator, sender or rule owner, and either a quantified delay or "not quantified"), the unknowns, a suggested next step and the boundary note, **Then** the findings can be finalised and the workshop moves to findings recorded.
2. **Given** findings with fewer than three delay sources, **When** the operator tries to finalise them, **Then** it is refused unless a reason for the shortfall is recorded, in which case they are finalised and marked as finalised with a recorded reason.
3. **Given** findings with more than three delay sources, **When** they are saved, **Then** the extra sources are refused and the operator is told the three biggest must be chosen.
4. **Given** a delay source with no owner class, or with an owner class outside the three allowed, **When** the findings are finalised, **Then** it is refused.
5. **Given** a delay source, **When** the buyer confirms or does not confirm it and its owner, **Then** the confirmation status (confirmed, not confirmed, unknown) is recorded with who and when, and an unconfirmed delay is never shown as confirmed.
6. **Given** findings, **When** they are finalised, **Then** they carry an explicit note that this diagnosis is free and that remediation, scoping and delivery are paid work outside it, and the economic buyer and funding path are left as unknown for the qualification step.
7. **Given** the operator pastes their session notes, **When** they ask for a draft, **Then** a model may suggest a draft of the findings from those notes only; nothing is recorded until the operator accepts and edits it, and the draft never invents a delay source, an owner or a number that the notes do not contain.
8. **Given** finalised findings, **When** they are corrected later, **Then** the correction is a new version with a reason, and the earlier version stays readable.

---

### User Story 6 - Offer 6 findings: ten fields traced, and a bounded view (Priority: P1)

After an Offer 6 session the operator records, for each of the ten fields the buyer named, the source system, the source message or interface, and how the field looks on quality, completeness, freshness, provenance and access, each with a status of known good, gap or unknown. Unknown is never treated as negative. The operator records an overall view of go, no-go or conditional with the unknowns stated and a disclaimer that it is not a guarantee of model performance, and drafts the scope of an Input Audit (one use case, one or two sources).

**Why this priority**: This is the product of the 90-minute session and the reason the buyer came (Scenario B). The unknown-versus-negative distinction is what makes it honest.

**Independent Test**: Record Offer 6 findings for all ten fields with a mix of known good, gap and unknown; set a conditional overall view; draft an Input Audit scope; finalise; then try with nine fields, a field with a missing dimension, a go view that hides unknowns, and a scope with three sources, and confirm each is refused unless the permitted reason is recorded.

**Acceptance Scenarios**:

1. **Given** a held Offer 6 workshop whose intake named ten fields, **When** the operator opens the findings, **Then** the ten field names from the intake are listed and no other field can be added.
2. **Given** each field, **When** the operator records its source system, source message or interface, and its quality, completeness, freshness, provenance and access observations, **Then** each of those five dimensions has a status of known good, gap or unknown, and a field with a dimension left unset is shown as incomplete.
3. **Given** findings with fewer than ten fields recorded, **When** the operator tries to finalise them, **Then** it is refused unless a reason is recorded.
4. **Given** a field whose dimension is unknown, **When** the overall view is shown, **Then** the unknown is listed as an unknown and is never counted as a gap or as a failure.
5. **Given** the overall view, **When** the operator chooses go, no-go or conditional, **Then** the view must list the unknowns it depends on and carries the disclaimer that it is not a guarantee of model performance; a go view that leaves a dimension of any field unknown is allowed only if the operator states why in words.
6. **Given** the findings, **When** the operator drafts the Input Audit scope, **Then** it names one use case and one or two sources; a scope with no use case, more than one use case or more than two sources is refused.
7. **Given** the operator pastes their session notes, **When** they ask for a draft, **Then** a model may suggest a draft of the field entries from those notes only; nothing is recorded until the operator accepts and edits it, and a field the notes do not mention stays unknown rather than being guessed.
8. **Given** a value, a sample record or patient-like text in any finding, **When** it is saved, **Then** the whole entry is refused and nothing is stored, as in Scenario D.
9. **Given** finalised findings, **When** they are corrected later, **Then** the correction is a new version with a reason, and the earlier version stays readable.

---

### User Story 7 - A one-page buyer output, reviewed before it is shared (Priority: P2)

From finalised findings the system prepares a one-page output for the buyer. The operator edits it and approves it; only an approved output can be shared. Every output contains an in-scope and out-of-scope section so a free session cannot drift into free consulting, and an Offer 6 output carries the not-a-guarantee disclaimer.

**Why this priority**: It is what the buyer takes away, and the point where the boundary of free work is made visible. It depends on findings existing, so it follows them.

**Independent Test**: Generate the output for finalised Offer 1 and Offer 6 findings; confirm each holds the findings, the in-scope and out-of-scope section and (Offer 6) the disclaimer; edit it, try to share it before approval and be refused, approve it and confirm it can then be shared; try to remove the scope section and be refused.

**Acceptance Scenarios**:

1. **Given** finalised findings, **When** the operator generates the output, **Then** a one-page draft is made from the findings, never from anything outside them, and it is a draft until a person approves it.
2. **Given** a draft, **When** the operator edits it, **Then** each edit is saved as a revision with who and when, and the findings are not changed by it.
3. **Given** a draft, **When** it is approved by a person who holds the output-approval right (the service lead or an administrator), **Then** it becomes approved and fixed as a one-page PDF, and a later edit makes a new draft; an operator without that right can edit and ask for approval but not approve.
4. **Given** a draft that is not approved, **When** anyone tries to share or export it, **Then** it is refused.
5. **Given** any output, **When** it is shown, **Then** it contains an in-scope section and an out-of-scope section, and it cannot be approved if either is missing or empty.
6. **Given** an output that uses restricted wording (for example a guarantee, a compliance claim, a service level, or a case-study figure) or states a price, **When** it is checked, **Then** it is flagged and cannot be approved until the wording is removed or covered by an approved claim.
7. **Given** an approved output, **When** it is shared, **Then** the sharing is recorded (who, when, how) and the system sends nothing itself; delivery to the buyer is a person's action or a later feature.
8. **Given** the findings are corrected after approval, **When** the output is looked at again, **Then** it is shown as out of date and a new draft is needed before anything more is shared.

---

### User Story 8 - Record the effort a workshop took (Priority: P3)

For each workshop the operator or delivering engineer records the delivery effort: preparation hours, session hours and the number of people who worked on it. Across workshops these figures let the team test the effort estimates held for each offer, which stay hypotheses until the data says otherwise.

**Why this priority**: It feeds a business question rather than any other step, so nothing else waits on it.

**Independent Test**: Record effort on three workshops of one offer and confirm a summary shows the totals and averages beside the offer's estimate, marked as a hypothesis, and that a negative or absurd figure is refused.

**Acceptance Scenarios**:

1. **Given** a workshop, **When** effort is recorded (preparation hours, session hours, people), **Then** it is stored with who recorded it and when, and a later correction is a new entry, not an overwrite.
2. **Given** effort figures outside the allowed ranges (negative, or beyond a sensible maximum), **When** they are recorded, **Then** they are refused with the reason.
3. **Given** several workshops for one offer, **When** the effort summary is read, **Then** it shows counts, totals and averages for each figure beside the offer's recorded effort estimate, labelled a hypothesis.
4. **Given** a workshop with no effort recorded, **When** the summary is read, **Then** it is counted as missing and not as zero.

---

### Edge Cases

- A request is converted twice at the same time: one workshop is made and the second attempt is told one already exists.
- The calendar provider is down, or returns a time that conflicts: booking by hand still works, and a failed provider call leaves the workshop in `requested`.
- A workshop is booked, the account is then suppressed or the contact withdraws consent: the workshop and its record stand, but nothing the system does after that contacts the person, and the operator sees a notice.
- The offer is withdrawn, expired or no longer approved after a workshop was requested: booking is refused with the offer's status; an already booked workshop can still be held or cancelled.
- A workshop is cancelled after the preparation brief was made: the brief and artifacts stay as history and are marked as belonging to a cancelled workshop.
- A no-show buyer wants to try again: a new workshop is made from the same request, the old one stays marked no-show, and capacity counts the old no-show as the offer's rules say.
- The intake for Offer 6 holds ten names but the session changes one: the field list for the findings is the intake's list; changing a name needs a recorded reason and is shown as changed.
- The findings, brief or output text includes a name, an email or a number that looks like a patient value: it is refused whole, nothing stored, and the operator is told.
- Two operators edit the same findings or output at once: the second save is refused with a plain message and the first is kept.
- The delivering engineer is not a registered user: participants can be recorded by name and role without an account, with no contact details held for people who are not already contacts.
- Findings are finalised with a recorded shortfall reason and the output is generated: the output states the shortfall plainly.
- A held artifact is never released: the checklist shows that item as not received and the findings can still be finalised.

## Requirements *(mandatory)*

### Functional Requirements

**Workshop and lifecycle**

- **FR-001**: The system MUST let a person convert a request that has been reviewed and linked to an account and contact, and that carries an Offer 1 or Offer 6 intake, into a workshop for that offer, linked to the request, account, contact and intake. A request that is not linked, is for another offer, or already has an open workshop MUST be refused with the reason.
- **FR-002**: A workshop MUST have a state of requested, booked, held, findings recorded or closed, or cancelled or no-show. Only these moves MUST be allowed: requested to booked or cancelled; booked to held, no-show or cancelled (and booked to booked when rescheduled); held to findings recorded; findings recorded to closed. Cancelled, no-show and closed are final.
- **FR-003**: Every move MUST be made by a person, MUST be recorded with who, when and (where the rules require it) a note or reason, and MUST be audited. A refused move MUST be audited without content. Closing MUST need finalised findings.
- **FR-004**: A workshop MUST record its booked date and time, its length (45 minutes for Offer 1, 90 minutes for Offer 6, as hypotheses read from the offer), and the history of every earlier date when it is rescheduled.
- **FR-005**: Booking MUST be possible by hand, and MUST go through a calendar interface that a live provider can later fill without changing any workshop rule. The first version ships a fake provider for tests and no live provider; a provider that is added later is off by default. A failed or unavailable provider MUST leave the workshop unchanged and MUST NOT block booking by hand. The booking is recorded the same way whichever route is used.
- **FR-006**: Nothing in this feature MUST send a message, an invitation or a reminder to anyone. Automated reminders and invitations belong to a later feature.

**Capacity**

- **FR-007**: Booking a workshop MUST count one session against its offer's capacity (feature 005) for the period containing the session date. Cancelling MUST release it. A reschedule MUST move the session to the period of its new date and MUST be refused, leaving the original booking, if that period is full.
- **FR-008**: Booking MUST be refused when the offer is full for the period, showing the capacity answer and offering the wait-list and the other alternatives from feature 006. An offer with no limit set MUST be allowed to book and MUST NOT be described as unlimited.
- **FR-009**: Held and no-show sessions MUST continue to count as used, and cancelled ones MUST NOT, exactly as feature 005 defines.

**Preparation brief**

- **FR-010**: The system MUST be able to draft a workshop preparation brief from the workshop's intake and the account's recorded evidence, with a structured shape: confirmed facts (each tied to its evidence), inferences (labelled), unknowns, suggested questions and a non-PHI artifact checklist. The brief MUST record which model and prompt version made it.
- **FR-011**: A brief MUST NOT state as a confirmed fact anything that the account's evidence does not support; an unsupported confirmed fact MUST be rejected or moved to inferences, and the brief MUST list unknowns rather than fill gaps. The artifact checklist MUST name only allowed non-PHI kinds.
- **FR-012**: Text from the intake, evidence or any other external source MUST be treated as data and never as instructions; the brief MUST NOT be able to change any workshop, finding, state or permission. A brief MUST NOT be drafted from text that failed the PHI check.
- **FR-013**: A new brief MUST NOT alter an earlier one; the earlier one stays readable and is shown as superseded. When the model is unavailable or a cost cap would be exceeded, a checklist-only brief MUST be available and the rest of the workshop MUST be unaffected. Every call MUST be checked against the cost caps and recorded with its cost.

**Artifacts and the data boundary**

- **FR-014**: An artifact MUST be recorded as metadata: its kind (specification, timeline, scrubbed rejection log, or another allowed non-PHI kind), title, where it is (a reference or a stored file), who supplied it, when, and a classification of non-PHI. The allowed kinds MUST be a configured list; any other kind MUST be refused.
- **FR-015**: Every free-text field and every file supplied MUST pass the PHI boundary check before anything is kept. A refusal of free text MUST be whole: nothing stored, logged or sent to a model. A file that looks as if it holds PHI MUST NOT be kept for use; it MUST be held for a reviewer, the operator MUST be alerted, and an audit event MUST record it without the content.
- **FR-016**: A held artifact MUST be released or discarded only by a person with the right permission, with a reason; a released artifact MUST be rechecked before use. Held content MUST never reach a model, a log, an event or a general view. If the check cannot run, the artifact MUST be refused rather than accepted.
- **FR-017**: The workshop's checklist MUST show each expected artifact as received, held or not received. Missing artifacts MUST NOT block the session or the findings.

**Offer 1 findings**

- **FR-018**: Offer 1 findings MUST hold: a summary of the onboarding flow; exactly three delay sources, each with a description, an owner class of operator, sender or rule owner, and a delay that is either quantified (an amount and unit) or marked "not quantified"; the unknowns; a suggested next step; and a note stating the boundary between this free diagnosis and paid work.
- **FR-019**: Offer 1 findings MUST NOT be finalised with fewer than three delay sources unless a reason for the shortfall is recorded, MUST NOT hold more than three, and MUST NOT be finalised with a delay source whose owner class is missing or outside the three allowed.
- **FR-020**: For each delay source the buyer's confirmation of the delay and its owner MUST be recorded as confirmed, not confirmed or unknown, with who recorded it and when; an unconfirmed item MUST NOT be presented as confirmed anywhere, including the output.
- **FR-021**: The findings MUST leave the economic buyer and the funding path out and state that they are for the qualification step. The system MUST NOT record a qualification decision in this feature.

**Offer 6 findings**

- **FR-022**: Offer 6 findings MUST list the ten fields named in the workshop's intake and no others. For each field they MUST hold the source system, the source message or interface, and five observations (quality, completeness, freshness, provenance, access), each with a status of known good, gap or unknown. Changing a field name MUST need a recorded reason and MUST be shown as changed.
- **FR-023**: An unknown status MUST be kept and shown as unknown. It MUST NOT be counted, scored, coloured or described as a gap or a failure anywhere, including the overall view and the output.
- **FR-024**: The findings MUST hold an overall view of go, no-go or conditional, with the unknowns it depends on listed, and a fixed disclaimer that it is not a guarantee of model performance. A go view that leaves any observation unknown MUST need a stated reason in words.
- **FR-025**: The findings MUST hold a draft Input Audit scope of one use case and one or two sources. A scope with no use case, more than one use case or more than two sources MUST be refused. The scope MUST NOT state a price or a duration commitment beyond the offer's recorded range.
- **FR-026**: Offer 6 findings MUST NOT be finalised with fewer than ten fields recorded unless a reason is recorded, and a field with an observation left unset MUST be shown as incomplete.

**Findings, versions and assistance**

- **FR-027**: Findings MUST be saved as typed records per offer, labelled non-PHI, and MUST be finalised by a person. A finalised set MUST NOT change; a correction MUST be a new version with a reason, and every version MUST stay readable.
- **FR-028**: Findings MUST NOT hold values, sample records, patient-level data, credentials or any price, budget or guarantee statement; every text MUST pass the PHI check and a violation MUST refuse the whole entry.
- **FR-029**: A model MAY suggest a draft of the findings from the operator's own pasted session notes only. The draft MUST be schema-checked, MUST NOT invent a delay source, owner, number, status or field that the notes do not contain, MUST leave anything the notes do not cover as unknown or empty, and MUST NOT be recorded until the operator accepts and edits it. The model MUST NOT finalise, approve, change a state or change a permission.

**Buyer output**

- **FR-030**: From finalised findings the system MUST be able to generate a one-page output draft, built only from those findings. An approved output MUST be made as a fixed one-page PDF kept with the workshop; the PDF is never edited, and any change starts a new draft. Every output MUST contain an in-scope section and an out-of-scope section, and an Offer 6 output MUST carry the not-a-guarantee disclaimer.
- **FR-031**: An output MUST be edited and approved by a person before it can be shared or exported. Each edit MUST be a revision with who and when. Approval MUST need the output-approval right, held by the service lead and administrators (people only); an operator can edit and ask for approval but cannot approve. An output MUST NOT be approvable if its in-scope or out-of-scope section is missing or empty, or if it holds a price, a restricted claim (feature 005's checker) or an unconfirmed item shown as confirmed.
- **FR-032**: Sharing an approved output MUST be recorded (who, when, how). The system MUST NOT send it. When the findings change after approval the output MUST be shown as out of date and MUST NOT be shared until a new draft is approved.

**Effort, access and records**

- **FR-033**: A workshop MUST be able to record delivery effort (preparation hours, session hours, number of people) with who and when; a correction MUST be a new entry. Figures outside the allowed ranges MUST be refused. A per-offer summary MUST show counts, totals and averages beside the offer's effort estimate, labelled a hypothesis, and MUST count a workshop with no effort as missing, not zero.
- **FR-034**: Participants (buyer-side and delivery-side) MUST be recordable by name and role, linked to a contact where one exists, with no contact details held for a person who is not already a contact.
- **FR-035**: Access MUST be permission-controlled: viewing workshops, converting and booking them, recording artifacts, drafting and editing findings, approving outputs, releasing held artifacts and recording effort MUST each map to permissions held by roles, with refusals audited. The role mapping is a hypothesis recorded for confirmation.
- **FR-036**: Every create, change, state move, finalisation, approval, sharing and held-artifact decision MUST be audited with who, what, when and why, and the feature MUST publish change notices carrying identifiers only for a workshop requested, booked, held and findings recorded.
- **FR-037**: Operators MUST have a workshop workspace showing the intake, participants, brief, artifact checklist, notes, the structured findings editor for the offer, and the output preview and approval, with every control shown only to a person who holds the permission.
- **FR-038**: Artifact files and approved output documents MUST be kept for 12 months after the workshop is closed (a configurable hypothesis) and then deleted; their metadata and the audit trail MUST stay. Held artifacts follow the existing quarantine retention. Deleting a file MUST be audited without its content.

### Key Entities

- **Workshop**: A session for Offer 1 or Offer 6 linked to a request, account, contact and intake, with its state, its offer, its length, its booked date and the history of its dates.
- **Participant**: A person who takes part, buyer-side or delivery-side, by name and role, linked to a contact where one exists.
- **PreparationBrief**: A schema-checked draft for the delivering engineer: confirmed facts with evidence, inferences, unknowns, suggested questions and an artifact checklist, with the model and prompt version that drafted it.
- **WorkshopArtifact**: A non-PHI specification, timeline, scrubbed rejection log or similar, recorded as metadata and a reference or stored file, with its classification and whether it is received, held or released.
- **WorkshopFindings**: The typed result for an offer, in versions: for Offer 1 the flow summary, three delay sources, unknowns, next step and boundary note; for Offer 6 the ten field traces, overall view, unknowns, disclaimer and draft Input Audit scope. A finalised version is fixed.
- **BuyerOutput**: A one-page document built from finalised findings, with revisions, an approval and a record of how it was shared.
- **DeliveryEffort**: Preparation hours, session hours and people for one workshop, with who recorded it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Scenario A, from the booked session through the findings and the delay-and-owner confirmation, and Scenario B, from approval through the ten-field trace, the bounded view and the draft Input Audit scope, pass end to end on the synthetic organisations; the economic buyer and funding path are left for qualification.
- **SC-002**: 100% of state moves that are not on the permitted path are refused, and 100% of permitted moves are audited with who, when and why.
- **SC-003**: In the acceptance set, booking never takes an offer above its limit, and 100% of cancellations release their place at once.
- **SC-004**: 100% of PHI-like artifacts and findings in the test corpus (including the `granite-health` case) are refused or held, none reaches a model or a log, and the operator is alerted for each.
- **SC-005**: 100% of Offer 1 findings with fewer than three delay sources, and of Offer 6 findings with fewer than ten fields, are refused unless a reason is recorded, and every such reason is shown on the findings and the output.
- **SC-006**: In 100% of Offer 6 findings, an unknown status is shown and described as unknown and never as a gap, in the findings, the overall view and the output.
- **SC-007**: 100% of buyer outputs contain an in-scope and an out-of-scope section, and 100% of outputs that were shared were approved by a person first.
- **SC-008**: A preparation brief for a synthetic organisation can be drafted and read in under two minutes, and in the test corpus 0 briefs state an unsupported fact as confirmed.
- **SC-009**: Recording the findings for a workshop and generating its one-page output takes an operator under 20 minutes from the held session, for each offer.
- **SC-010**: An effort summary per offer can be read at any time with no manual matching, and shows missing effort as missing.

## Clarifications

### Session 2026-11-23

- Q: Which calendar option does the first version support for booking a workshop? → A: Manual booking only, plus the calendar interface and a fake provider for tests; a live Google or Microsoft provider is a later change behind a switch (recommended).
- Q: In what form is the one-page buyer output produced? → A: A fixed one-page PDF made from the approved text, kept with the workshop; the approved text itself stays editable only as a new draft, and the PDF is never edited (recommended).
- Q: Do attendees receive automated invitations or reminders? → A: No. This feature sends nothing; invitations, reminders and sending the output belong to feature 009 or to a person's own action (recommended).
- Q: Who may approve a buyer output? → A: A person who holds the output-approval right (the service lead or an administrator, people only); an operator can edit and request approval but cannot approve (recommended).
- Q: How long are artifact files and output documents kept? → A: 12 months after the workshop is closed (a hypothesis, configurable), then the files are deleted while their metadata and the audit trail stay; held artifacts follow the quarantine retention (recommended).

## Assumptions

- The business source sections the description cites (6, 18 and 22.4) are not in the repository. This specification is built from the description, the runbook's Feature 007 entry, the guardrails, the glossary and acceptance Scenarios A, B and D; every field, threshold and wording not stated there is a labelled hypothesis, and the gap is recorded as an open question.
- "Approved request" means a request, from feature 006, that a person has reviewed and linked to an account and contact and that carries an Offer 1 or Offer 6 intake.
- Session lengths (45 and 90 minutes), the effort estimates and capacity limits come from the offer catalogue (feature 005) and are hypotheses.
- Booking records and capacity counting use feature 005's bookings; a workshop's booking is the same record.
- A calendar provider is optional. The first version works with manual booking and a fake provider for tests; a live Google or Microsoft integration is a later change behind a switch that is off by default (clarified 2026-11-23).
- Nothing is emailed: attendee invitations, reminders and sending the output are feature 009 or a person's own action (clarified 2026-11-23). This feature records that an output was shared but does not send it.
- The one-page output is previewed as text, edited as drafts, and made as a fixed one-page PDF when approved (clarified 2026-11-23); an editable document format is not offered.
- The model only assists: it drafts the preparation brief from intake and evidence, and may suggest findings from the operator's pasted notes. Every state, finalisation, approval and boundary decision is made by a person or by plain rules, never by a model.
- Qualification, the economic buyer, the funding path and any scoping recommendation belong to feature 008; this feature leaves them as unknowns and records nothing about them.
- Held artifacts use the existing quarantine and operator-alert mechanism from feature 001; the permission to release or discard them is the existing quarantine-review right.
- Participants who are not contacts are recorded by name and role only; no contact detail is kept for them.
- Buyer-supplied text (intake, notes) is untrusted and is treated as data wherever a model sees it.
