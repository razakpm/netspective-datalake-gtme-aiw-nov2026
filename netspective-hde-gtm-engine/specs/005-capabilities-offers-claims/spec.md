# Feature Specification: Service Capabilities, Offer Catalog and Claims

**Feature Branch**: `005-capabilities-offers-claims`

**Created**: 2026-11-19

**Status**: Draft

**Input**: User description: "Service Capabilities, Offer Catalog, Paid Engagement Types, Capacity and Claim governance (read docs/context/00-source-prompt.md §§4, 6, 12, 13.1, 14.2 and docs/context/01-guardrails.md). Goal: make what Netspective can credibly offer — and what it must not claim — explicit, versioned configuration."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Claim governance and the claim linter (Priority: P1)

A marketing approver needs every public statement (a landing-page promise, a content sentence) to be a recorded claim that is either backed by approved evidence or left out. A deterministic checker flags restricted phrases in any text, so nobody has to rely on memory or on a model to spot "AI-ready", an SLA, SOC 2, a guarantee, "HIPAA compliant" or an outcome percentage.

**Why this priority**: This is the guardrail that protects the company from unsupported public claims. Offers, content and outreach all depend on it, and it needs no other catalogue data to work.

**Independent Test**: Run the checker over a test corpus of phrases and sentences; every restricted phrase is flagged and every clean sentence passes. Then create a claim of a restricted class without evidence and try to approve it.

**Acceptance Scenarios**:

1. **Given** text containing "AI-ready", an SLA, "SOC 2", "guarantee", "HIPAA compliant" or a percentage tied to an outcome, **When** the checker runs, **Then** each occurrence is flagged with the restricted class, the matched phrase and its position.
2. **Given** text with none of the restricted phrases, **When** the checker runs, **Then** nothing is flagged.
3. **Given** a claim in a restricted class, **When** it has no linked evidence, **Then** it cannot be approved and the suggested action is to omit the statement.
4. **Given** a restricted claim with linked evidence, **When** only one person has reviewed it, **Then** it stays unapproved until the designated second approver signs off.
5. **Given** a claim that is not in a restricted class, **When** a designated approver approves it with linked evidence, **Then** it becomes approved and the approval is recorded with who, when and why.
6. **Given** any approval or rejection, **When** it is recorded, **Then** it cannot be edited afterwards; a later decision is a new record.

---

### User Story 2 - Offer catalogue with immutable versions (Priority: P1)

A service lead maintains the ten engagement offers, each with its format, target ICP, buyer output, buyer effort, Netspective effort estimate (labelled as a hypothesis), conversion path, landing-page promise, call to action, intake fields, success hypotheses, SQL rule reference and a status that moves from draft to internally reviewed to approved to available, and ends as withdrawn or expired. Every change creates a new version; earlier versions are kept unchanged.

**Why this priority**: Routing, workshops, qualification and content all read the offer catalogue. Without it nothing downstream knows what may be offered.

**Independent Test**: Seed the catalogue, edit an offer, and confirm a new version exists while the old one is unchanged. Try each allowed and disallowed status move.

**Acceptance Scenarios**:

1. **Given** the seeded catalogue, **When** it is read, **Then** Offers 1, 5 and 6 are approved and Offers 2, 3, 4, 7, 8, 9 and 10 are draft and inactive.
2. **Given** an offer, **When** a service lead changes it, **Then** a new version is created, and every earlier version stays readable and unchanged.
3. **Given** an offer in any status, **When** a move outside the allowed order is requested (for example draft straight to available), **Then** it is refused with a plain reason.
4. **Given** Offer 7 with its limitation "evaluation is a buyer prompt only" unacknowledged, **When** someone tries to activate it, **Then** activation is refused until a named person acknowledges the limitation, and the acknowledgement is recorded.
5. **Given** an offer whose landing-page promise or other public text contains a restricted phrase, **When** it is moved to approved or available, **Then** the move is refused until the text is cleared or each statement is an approved claim.
6. **Given** the effort estimate on any offer, **When** it is shown, **Then** it is labelled as a hypothesis.

---

### User Story 3 - Capacity per offer and period (Priority: P2)

A delivery lead sets how many sessions each offer can run per period (for example Offer 6 per month, Offer 1 per week) and sees how much is used. Other features can ask whether an offer is full for a period.

**Why this priority**: Routing must stop recommending an offer that has no room, but this only matters once offers exist.

**Independent Test**: Set a limit, record usage up to the limit, and confirm the "exhausted" answer appears and clears when the period rolls over or the limit is raised.

**Acceptance Scenarios**:

1. **Given** a capacity limit for an offer and period, **When** usage is below the limit, **Then** the offer reports remaining room and its utilisation.
2. **Given** usage equal to or above the limit, **When** another feature asks, **Then** the answer is "exhausted" for that period, with the limit and usage.
3. **Given** a change to a limit, **When** it is saved, **Then** the previous value, who changed it and when are kept.
4. **Given** an offer with no limit set, **When** another feature asks, **Then** the answer says "no limit set" and does not claim unlimited room.

---

### User Story 4 - Service capability catalogue (Priority: P2)

A service lead maintains the initial 19 service capabilities. Each has a description, input and output types, the buyer problems it addresses, its evidence basis, known delivery examples (internal only), limitations, required expertise, related offers, the paid engagement it could lead to, and a public-claim approval status.

**Why this priority**: Research, hypotheses and routing use capabilities to say what Netspective can credibly discuss. It replaces the provisional list used by account research.

**Independent Test**: Seed the 19 capabilities, edit one, link it to an offer, and confirm internal delivery examples never appear in any public-facing view.

**Acceptance Scenarios**:

1. **Given** the seeded catalogue, **When** it is read, **Then** it holds the 19 initial capabilities, each with every required attribute present or explicitly marked unknown.
2. **Given** a capability, **When** it is linked to offers and a paid engagement type, **Then** those links are visible from both sides.
3. **Given** a capability with internal delivery examples, **When** its public-claim status is anything other than approved, **Then** the examples are available to internal users only and no public view includes them.
4. **Given** a capability with no evidence basis recorded, **When** someone tries to mark it approved for public claims, **Then** it is refused.

---

### User Story 5 - Paid engagement types and offer scoring (Priority: P3)

A service lead keeps the three paid engagement types and the offer scoring table. The types are Sender Readiness Sprint (6 weeks, 3–5 senders, one format, per-sender rejection reporting, header contract, raw-first landing), Input Audit (6–8 weeks, one use case, 1–2 sources, lineage-tracked feed, go/no-go memo) and Resilience Review (scope to be confirmed, inactive). No price is stored. The scoring table is kept as judgement scores labelled hypothesis.

**Why this priority**: Qualification and scoping (feature 008) need the types, but only after offers and claims exist.

**Independent Test**: Read the three types and confirm no price fields exist; try to add a deliverable that is not in the source and confirm it needs approval.

**Acceptance Scenarios**:

1. **Given** the seeded types, **When** they are read, **Then** Sender Readiness Sprint and Input Audit carry the scope details above and Resilience Review is inactive with scope marked "to be confirmed".
2. **Given** any paid engagement type, **When** its fields are listed, **Then** there is no price, fee or rate field and none can be added through this feature.
3. **Given** a proposed deliverable that is not in the source material, **When** it is added, **Then** it is rejected unless a designated approver approves it, and the approval is recorded.
4. **Given** the scoring table, **When** it is shown, **Then** every score is labelled as a judgement and a hypothesis, and a changed score keeps its history.

---

### Edge Cases

- A restricted phrase appears inside a longer word or in different capitalisation or spacing ("ai ready", "AI‑ready", "S.L.A."): the checker still flags the intended phrases and does not flag unrelated words.
- A percentage appears that is not tied to an outcome (for example "page 50%"): the checker flags only outcome-tied percentages, and a person can mark a flag as a false positive with a reason that is recorded.
- Two people edit the same offer at once: the second save is refused with a message to reload, so no version is silently overwritten.
- An approved or available offer needs a correction: a new version is created and goes through review again; the approved version stays in force until the new one is approved.
- An offer is withdrawn or expires while a period's capacity is partly used: its usage is kept for reporting and it reports as not available.
- A claim's evidence is later withdrawn or expires: the claim moves to "needs review" and public use of it is flagged.
- The same person tries to give both approvals on a restricted claim: refused; the second approval must come from a different designated approver.
- A deliverable or capability text includes patient-level data or credentials: refused under the data boundary.

## Requirements *(mandatory)*

### Functional Requirements

**Claims and the linter**

- **FR-001**: The system MUST represent every public claim (landing-page promise, content statement) as a claim record linked to its evidence.
- **FR-002**: The system MUST treat these as restricted claim classes: quantified outcome, production status, SLA or RTO, SOC 2 or other certification, tenant isolation, legal or regulatory compliance, "AI-ready", and customer identity or case-study details.
- **FR-003**: A claim in a restricted class MUST NOT be approved without linked evidence and sign-off from designated approvers; the default for any unapproved claim is omission.
- **FR-004**: The system MUST provide a deterministic claim checker that flags restricted phrases in any text, returning for each match the class, the matched text and its position. It MUST NOT use a language model.
- **FR-005**: The checker MUST flag at least: "AI-ready", SLA, SOC 2, "guarantee", "HIPAA compliant", and percentages tied to outcomes, and MUST handle capitalisation, hyphen and spacing variants.
- **FR-006**: The restricted phrase list MUST be versioned configuration with a recorded owner and change history, so a change to it is itself reviewed.
- **FR-007**: Approvals, rejections and false-positive dispositions MUST be recorded with who, when and why, and MUST NOT be editable afterwards.
- **FR-008**: A claim whose evidence is withdrawn or expires MUST move to needs-review and be flagged wherever it is used.

**Offers**

- **FR-009**: The system MUST hold the ten engagement offers with the attributes listed in User Story 2 and a status of draft, internally reviewed, approved, available, withdrawn or expired.
- **FR-010**: The system MUST only allow status moves in the defined order (draft → internally reviewed → approved → available; any → withdrawn; available or approved → expired) and MUST refuse others with a plain reason.
- **FR-011**: Every change to an offer MUST create a new immutable version; versions MUST be readable and MUST NOT be edited or deleted.
- **FR-012**: The system MUST seed Offers 1, 5 and 6 as approved and Offers 2, 3, 4, 7, 8, 9 and 10 as draft and inactive.
- **FR-013**: An offer carrying a recorded limitation MUST NOT be activated until a named person has acknowledged the limitation; Offer 7's limitation "evaluation is a buyer prompt only" is seeded as such.
- **FR-014**: Moving an offer to approved or available MUST be refused while its public text contains a restricted phrase that is not covered by an approved claim.
- **FR-015**: The Netspective effort estimate and any score MUST be labelled as a hypothesis wherever shown.
- **FR-016**: Each offer MUST reference its SQL rule by identifier; the rule itself is owned by qualification, not edited here.

**Capacity**

- **FR-017**: The system MUST let a delivery lead set a capacity limit per offer per period (week or month) and MUST keep the history of changes.
- **FR-018**: The system MUST report, per offer and period, the limit, usage, remaining room and utilisation, and MUST report "no limit set" when none exists.
- **FR-019**: The system MUST expose an "exhausted" answer per offer and period that other features (notably offer routing) can query.
- **FR-020**: Usage MUST come from recorded sessions supplied by workshop operations; until that feature exists, usage can be entered by a delivery lead and is labelled as manual.

**Capabilities, paid engagement types and scoring**

- **FR-021**: The system MUST hold the 19 initial service capabilities with the attributes listed in User Story 4, each present or explicitly unknown.
- **FR-022**: Internal delivery examples MUST be visible only to internal users and MUST NOT appear in any public-facing output.
- **FR-023**: A capability MUST NOT be marked approved for public claims without a recorded evidence basis and an approved claim.
- **FR-024**: The system MUST hold Sender Readiness Sprint, Input Audit and Resilience Review as paid engagement types with the scope details given, Resilience Review inactive.
- **FR-025**: The system MUST NOT store or accept any price, fee or rate for a paid engagement type.
- **FR-026**: A deliverable not present in the source material MUST be rejected unless a designated approver approves it, with the approval recorded.
- **FR-027**: The system MUST store the offer scoring table as judgement scores labelled hypothesis, with change history.

**Access, audit and data boundary**

- **FR-028**: Service leads MUST be able to edit capabilities and offers; delivery leads MUST be able to set capacity; only designated claim approvers MUST be able to approve claims; everyone with read access to the catalogue MUST be able to read it.
- **FR-029**: Every create, change, status move, approval and capacity change MUST be recorded in the audit trail with who and when, and MUST publish a change notice carrying identifiers only.
- **FR-030**: The system MUST NOT store patient-level data, credentials or customer-identifying case-study details in any catalogue field, and MUST refuse text that matches the PHI guard.
- **FR-031**: The catalogue MUST provide screens for browsing capabilities, working on offers and reviewing claims, showing a plain message for every refusal.
- **FR-032**: Publishing landing pages and setting prices are out of scope; this feature only governs what may be said and offered.

### Key Entities

- **ServiceCapability**: An engineering capability Netspective can credibly discuss, with description, input and output types, buyer problems, evidence basis, internal delivery examples, limitations, required expertise, related offers, potential paid engagement and public-claim status.
- **EngagementOffer**: One of the ten offers, with a status and a series of immutable **OfferVersions** holding the attributes in User Story 2.
- **OfferLimitation**: A recorded constraint on an offer (for example Offer 7's) with who acknowledged it and when.
- **OfferCapacity**: A limit per offer per period, with usage, history and an exhausted answer.
- **PaidEngagementType**: Sender Readiness Sprint, Input Audit or Resilience Review, with scope details, status and approved deliverables; no price.
- **OfferScore**: A judgement score per offer and criterion, labelled hypothesis, with history.
- **Claim**: A public statement with a class, a status and its linked evidence.
- **ClaimEvidence**: A reference supporting a claim, with an owner and an expiry.
- **ClaimReview**: An immutable approval, rejection or false-positive record by a designated approver.
- **RestrictedPhraseList**: The versioned set of phrases and patterns, by restricted class, used by the checker.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The checker flags 100% of the restricted phrases in the agreed test corpus and produces no flag on the clean sentences in it.
- **SC-002**: No claim in a restricted class can reach approved without evidence and two distinct designated approvers; 0 exceptions in testing.
- **SC-003**: Offer 7 cannot be activated while its limitation is unacknowledged; 100% of attempts are refused with a plain reason.
- **SC-004**: Every earlier offer version can be read back exactly as saved after any number of later changes.
- **SC-005**: Another feature can learn whether an offer is exhausted for the current period in one request, and the answer matches the recorded limit and usage in 100% of test cases.
- **SC-006**: A service lead can find any capability or offer and see its status and limitations within 30 seconds of opening the catalogue.
- **SC-007**: No price field exists on any paid engagement type, and no internal delivery example appears in any public-facing output.
- **SC-008**: Every change to a capability, offer, capacity limit or claim has a matching audit record naming who made it.

## Assumptions

- Seed content for the 19 capabilities, the ten offers and the scoring table comes from the project's business source (sections 4, 6 and 12). Those sections are not in `docs/context/00-source-prompt.md`, which holds only the build runbook, guardrails and a short offer summary. See the open clarification below.
- Facts already in the repository are used as given: Offers 1, 5 and 6 and their routing (guardrails), Offer 7's limitation, Offer 8 as the Resilience Review offer (inactive until its scope is defined), and no pricing.
- Initial capacity defaults, kept as hypotheses and editable: Offer 6 three sessions per month and Offer 1 three sessions per week during validation (open questions 6 and 7).
- Designated claim approvers are the service lead and a marketing approver, with two people required for restricted claims (open question 21).
- The restricted phrase list is owned by the marketing approver; a change to it is reviewed by a second designated approver.
- All numeric values, effort estimates and scores are hypotheses until the business confirms them.
- Capacity usage will come from feature 007 (workshop operations); until then usage is entered by hand.
- Feature 004 uses a provisional capability list; once this catalogue is available, research and hypotheses read capabilities from here.
- Landing-page publishing, content drafting (feature 009) and routing (feature 006) are separate features that consume this one.

## Open Clarification

- [NEEDS CLARIFICATION: The business source sections for the 19 initial capabilities (§12), the ten offers (§6) and the offer scoring table (§6.2) are not in the repository. Should the seed use content you supply now, or seed only the facts already recorded in the repository (Offers 1, 5, 6, 7 and 8, the three paid engagement types) and mark the remaining capabilities, offers and scores as "to be provided" placeholders?]
