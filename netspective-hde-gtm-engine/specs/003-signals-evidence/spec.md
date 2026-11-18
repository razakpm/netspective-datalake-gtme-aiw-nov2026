# Feature Specification: Signals and Evidence

**Feature Branch**: `003-signals-evidence`

**Created**: 2026-11-17

**Status**: Draft

**Input**: User description: "Signals and Evidence — a provenance-first evidence layer. A Signal is an observation that may indicate need, never a conclusion." (full description in the originating `/speckit-specify` prompt; see `docs/context/00-source-prompt.md` Feature 003, `docs/context/01-guardrails.md`, `docs/context/02-glossary.md` and `docs/context/04-acceptance-scenarios.md`)

## Clarifications

### Session 2026-11-17

- Q: Who may approve or reject a signal, and may a person approve a signal they recorded themselves? → A: Technical SME reviewers and administrators may approve, reject, mark contradictory and re-verify, including signals they recorded themselves; no other role may.
- Q: How should a signal's reliability be rated? → A: Four values: high (official publication or a buyer's own statement), medium (reputable third party or an analyst's direct observation), low (unattributed, secondary or inferred) and unknown; the source kind sets the default and a reviewer may change it per signal with a recorded reason.
- Q: Should a signal that nobody has reviewed yet count as current evidence? → A: No. Only a signal approved by a reviewer counts as current evidence; unreviewed signals stay visible, labelled "pending review", and are never counted, whoever entered them.
- Q: When a duplicate merges into a signal a reviewer has already approved, should it stay approved, return to pending review, or stay approved with a flag? → A: It stays approved and is flagged "new provenance since review" until a reviewer clears the flag; a merge never changes the observation text.
- Q: May an individual source set a shorter excerpt limit than the global default? → A: Yes. A source may set a shorter limit (down to none, meaning citation only) but never a longer one; the global limit is a hard ceiling.

## User Scenarios & Testing *(mandatory)*

This feature gives the GTM team a trustworthy, traceable record of *what has been observed* about an organisation, separate from *what we conclude*. A **signal** is a single observation (for example "this exchange published an updated implementation guide" or "this health system's pilot stalled") that records where it came from, when, how reliable it is, and who has checked it. Signals feed later features (research and hypotheses in 004, qualification in 008, intent in 011), but this feature never draws conclusions itself: it does not set ICP fit, hypotheses, funding paths, buyers or recommendations. It does not research the web or ingest first-party events (004 and 010); signals arrive here from a person or from a provider interface. All data used and shown is non-PHI business information; sample organisations and sources in tests are synthetic.

### User Story 1 - Record a signal with a source and a typed place in the taxonomy (Priority: P1)

A research analyst records a signal about an organisation: what was observed, where it came from, which kind of signal it is, and optionally which contact it relates to. The kind comes from a versioned taxonomy with nine categories (A organisation/program, B interoperability, C operational data quality, D data platform/architecture, E procurement/funding, F hiring/capability gap, G executive/stakeholder change, H regulatory/ecosystem context, I first-party Netspective). A signal can be entered by hand or handed over by a provider interface, and both take the same path. A signal with no source is refused.

**Why this priority**: Everything else rests on signals existing with a source and a type. A signal with no traceable source is exactly the unsupported inference the product is built to avoid.

**Independent Test**: Record signals for the synthetic organisations by hand and through the provider path, with and without a source, a type, an account and a contact.

**Acceptance Scenarios**:

1. **Given** an existing account, **When** an analyst records a signal with a source, a type from the current taxonomy and an observation, **Then** the signal is saved, linked to the account (and to the contact if one was named), shown as unreviewed, and the taxonomy version it was recorded under is stored on it.
2. **Given** a signal without a source (no source name and no URL or identifier), **When** it is submitted, **Then** it is refused with a message naming the missing source and nothing is saved.
3. **Given** a signal with a type that is not in the current taxonomy, an unknown account, or a contact who does not belong to that account, **When** it is submitted, **Then** it is refused with that specific reason.
4. **Given** the same observation arriving from a provider interface, **When** it is submitted, **Then** it is validated by exactly the same rules as a manual entry and is labelled with its extraction method.
5. **Given** a first-party Netspective type (category I), **When** an analyst records one, **Then** it is accepted, even though automatic first-party ingestion is a later feature.
6. **Given** an observation that reads like a conclusion (for example "this organisation is a strong ICP fit" or "they will buy"), **When** it is entered as a signal, **Then** the observation text is stored only as an observation; no field of the signal can express fit, hypothesis, intent or a buying decision.

---

### User Story 2 - Every signal carries full provenance (Priority: P1)

Each signal stores everything needed to judge and re-check it: source or provider; URL or identifier; a short permitted excerpt; a normalised statement of the observation; when it was observed, collected and (if known) published; its reliability; the extraction method and extraction confidence; its relevance to an ICP, a service capability and an offer; its freshness policy; links to supporting and contradictory evidence; its evidence status (including buyer-confirmed); its review status; the AI model and prompt version if an AI helped extract it; the chain of provenance; its retention policy; and its sensitivity classification. Provenance can be viewed in one place.

**Why this priority**: Provenance is the product's central promise ("evidence before inference"). Without it, later conclusions cannot be defended.

**Independent Test**: Record a manual signal and an AI-extracted signal and check that every provenance field is present, correct and viewable; try to save a signal with required provenance missing.

**Acceptance Scenarios**:

1. **Given** a complete signal, **When** it is viewed, **Then** every provenance field in the list above is shown, with missing optional items shown as "not recorded" rather than hidden.
2. **Given** a signal extracted with AI help, **When** it is saved, **Then** the model and prompt version are recorded, the evidence status cannot be `buyer_confirmed`, and an AI actor cannot raise reliability or confirm anything.
3. **Given** the evidence status list (observed, buyer-confirmed, derived interpretation, AI hypothesis, unverified assumption, contradictory), **When** a signal is recorded, **Then** it carries exactly one status; repetition or summarising never upgrades it, and only a person (never an AI or a provider) can record a signal as buyer-confirmed, and only when the source is a buyer statement.
4. **Given** a signal that links to other evidence, **When** it is saved, **Then** each link is marked as supporting or contradictory and both lists are always present (possibly empty).
5. **Given** any text field of a signal (excerpt, observation, notes), **When** it is submitted, **Then** it passes the PHI boundary check first; if it looks like PHI the signal is refused, nothing is stored or logged, and an audit event is recorded.
6. **Given** a signal, **When** its sensitivity classification is read, **Then** it is one of the permitted classifications and never `prohibited`.

---

### User Story 3 - Excerpts are limited and some sources are citation-only (Priority: P1)

Only a short excerpt may be kept. An excerpt longer than the configured permitted length, or any excerpt from a source marked "no storage", is not stored: the signal keeps the citation (source, URL or identifier, date) and the normalised observation, and records that the excerpt was withheld.

**Why this priority**: Storing long copies of third-party text can breach source terms and creates avoidable risk. This rule has to hold from the first signal.

**Independent Test**: Submit signals with short, over-length and no-storage excerpts and check what is stored.

**Acceptance Scenarios**:

1. **Given** an excerpt within the permitted length from a normal source, **When** the signal is saved, **Then** the excerpt is stored as given.
2. **Given** an excerpt longer than the permitted length, **When** the signal is saved, **Then** the excerpt is not stored, the signal keeps its citation and observation, and it shows "excerpt withheld: too long".
3. **Given** a source marked "no storage", **When** any signal from it is saved, **Then** no excerpt is stored and the signal shows "excerpt withheld: source does not permit storage".
4. **Given** a withheld excerpt, **When** the signal is viewed, **Then** the reader can still follow the citation to the original.

---

### User Story 4 - Near-duplicate signals merge into one with merged provenance (Priority: P1)

When a new signal matches an existing one (same account, same type, same source and overlapping content), the two are treated as one signal. The existing signal gains the new observation in its provenance chain; no second signal is created. Submitting the same thing again changes nothing. The same underlying item found at two different sources (for example one RFP posted on two portals) is also recognised as one observation with both sources recorded, and it is not counted as two independent confirmations.

**Why this priority**: Without de-duplication the feed fills with repeats and repeated mentions look like corroboration, inflating confidence in a hypothesis.

**Independent Test**: Submit the same signal repeatedly, a lightly reworded copy, and the same RFP from two portals, and check the resulting signals and provenance.

**Acceptance Scenarios**:

1. **Given** an existing signal, **When** an identical signal is submitted, **Then** no new signal is created, nothing changes, and the result says it already exists (idempotent).
2. **Given** an existing signal, **When** a near-duplicate (same account, type and source, overlapping content) is submitted, **Then** it is merged: one signal remains, its provenance chain gains an entry (who, when, how), and the original observed date is kept.
3. **Given** the same RFP posted on two portals, **When** both are recorded, **Then** they are one signal with two sources in its provenance, and for corroboration purposes they count as one independent source, not two.
4. **Given** two signals with the same account and type but different content or a different source that is clearly a separate observation, **When** both are recorded, **Then** they stay separate.
5. **Given** a merge, **When** the merged signal is viewed, **Then** the reviewer can see every contributing entry and nothing from either entry is lost.
6. **Given** a signal that was already approved, **When** a duplicate merges into it, **Then** it stays approved, its observation text is unchanged, the merge is shown in its history, and it is flagged "new provenance since review" until a reviewer clears the flag.

---

### User Story 5 - Review signals and browse them in a filterable feed (Priority: P1)

A technical SME reviewer works through a Signal Feed filtered by type, ICP, organisation, source, capability, offer, confidence, freshness and review status. For each signal they can approve it, reject it with a reason, or mark it contradictory (linking the signal it contradicts). Reviewing never edits the observation; it records a decision with who, when and why.

**Why this priority**: Human review is what turns raw observations into evidence others may rely on. Unreviewed signals must be visible but must not be treated as vetted.

**Independent Test**: Load signals for the synthetic organisations, filter the feed, approve, reject and mark signals contradictory as a reviewer, and check that a user without review permission cannot.

**Acceptance Scenarios**:

1. **Given** unreviewed signals, **When** a reviewer filters the feed by any of the nine filters (alone or combined), **Then** only matching signals are shown, newest first, with their review status and freshness visible.
2. **Given** an unreviewed signal, **When** a reviewer approves it, **Then** its review status becomes approved, the decision (who, when) is stored, and the observation is unchanged.
3. **Given** a signal, **When** a reviewer rejects it without a reason, **Then** the rejection is refused; with a reason it is saved and the signal is excluded from current evidence but kept in history.
4. **Given** a signal that conflicts with another, **When** a reviewer marks it contradictory and links the other signal, **Then** both are flagged as contradicting each other and neither is deleted.
5. **Given** a user without review permission, **When** they try to approve, reject or mark contradictory, **Then** the attempt is refused and audited.
6. **Given** a decided signal, **When** a reviewer changes their mind, **Then** the new decision is added as a further entry; earlier decisions remain in history.

---

### User Story 6 - Signals go stale and drop out of current evidence (Priority: P2)

Each signal type has a freshness policy (a window after which the observation is considered stale). A signal past its window is flagged stale and no longer counts as "current evidence"; it remains in history and can be viewed. A rule-based check, not an AI, decides this, and re-checking is repeatable.

**Why this priority**: Old observations (an executive who has since left, a procurement that closed) must not support today's conclusions, but this builds on signals existing and being reviewable.

**Independent Test**: Record signals of different types with different dates and check, before and after the window, which count as current.

**Acceptance Scenarios**:

1. **Given** a signal within its type's freshness window, **When** current evidence is requested for the account, **Then** it is included (if approved).
2. **Given** the same signal after its window has passed, **When** current evidence is requested, **Then** it is excluded, it is flagged stale in the feed and on the account, and it is still viewable.
3. **Given** two types in different categories, **When** the same age passes, **Then** each follows its own window.
4. **Given** an undated source (no published date), **When** its freshness is judged, **Then** freshness runs from the date it was collected, the signal is flagged "undated", and it never appears fresher than its collection date.
5. **Given** a signal that was rejected or is awaiting a decision about a contradiction, **When** current evidence is requested, **Then** it is excluded regardless of age.
6. **Given** the same signals and the same date, **When** freshness is evaluated twice, **Then** the results are identical.

---

### User Story 7 - Funding signals stay "funding context" unless budget approval is stated (Priority: P2)

A signal about funding (a grant announcement, a budget line, a procurement notice) is stored as **funding context**. It becomes **budget-approval evidence** only when the source explicitly states that a budget has been approved. Even then, a signal is only evidence: it never sets a "funding path confirmed" status. That status belongs to qualification (a later feature) and needs buyer confirmation.

**Why this priority**: Funding path decides whether an opportunity is a sales-qualified lead. Mistaking an announcement for approved budget would inflate the pipeline.

**Independent Test**: Record a grant announcement, a budget-approval statement and a buyer statement and check how each is classified and that none sets a funding path.

**Acceptance Scenarios**:

1. **Given** a grant or funding announcement, **When** it is recorded, **Then** it is classified funding context and cannot be classified as budget-approval evidence.
2. **Given** a source that explicitly states budget approval, **When** it is recorded with that statement cited, **Then** it may be classified budget-approval evidence; the statement must be cited in the signal.
3. **Given** any funding signal in any classification, **When** its record is read, **Then** it contains no "funding path confirmed" value and nothing in this feature can set one.
4. **Given** a funding signal that is only a hypothesis (derived or AI-suggested), **When** it is recorded, **Then** it is labelled with its evidence status and stays funding context.

---

### User Story 8 - Regulatory signals are context-only and must be re-verified (Priority: P2)

Signals about regulation and the wider ecosystem (CMS-0057-F, TEFCA, RHTP, implementation-guide changes) are tagged context-only and carry a "re-verify before external use" flag. They may explain why an organisation is under pressure, but they are never used as proof of a requirement. HTI-5 is never stored as a final requirement.

**Why this priority**: Regulatory status changes and is easy to misstate; the product must not make legal or compliance claims it cannot support.

**Independent Test**: Record regulatory signals including one naming HTI-5 and check the tags, flag and the refusal to mark HTI-5 final.

**Acceptance Scenarios**:

1. **Given** a regulatory or ecosystem signal (category H), **When** it is recorded, **Then** it is tagged context-only and flagged "re-verify before external use", and the flag cannot be removed except by a reviewer re-verifying it against the source, with that recorded.
2. **Given** a regulatory signal, **When** the status of the rule is recorded, **Then** the status is one of proposed, unverified or reported-as-final-by-source, each with the flag; a signal never states that an organisation is compliant or non-compliant.
3. **Given** a signal that names HTI-5, **When** its rule status is recorded, **Then** it may not be recorded as final; attempting to do so is refused.
4. **Given** a regulatory signal, **When** an external-use check asks whether it can be used outside the team, **Then** the answer is "not without re-verification".

---

### Edge Cases

- **Source URL dies**: the signal is kept; its citation, retrieval date and observation remain; the source is marked "unavailable since <date>"; the signal's reliability is not silently changed, but a reviewer is shown the unavailability.
- **Same RFP posted on two portals**: one observation, two sources in its provenance; counts as one independent source (see User Story 4).
- **Contradictory signals of equal reliability**: both are kept and flagged contradictory; neither is preferred; the pair is shown side by side to a reviewer; any later conclusion cannot treat either as settled until a person decides.
- **Undated sources**: freshness runs from the collection date, the signal is flagged undated, and it is never presented as more recent than collected (see User Story 6).
- **Observation that looks like a conclusion**: stored only as observation text; no field can carry fit, hypothesis, intent or buyer decisions (see User Story 1).
- **PHI-like text** in an excerpt, observation, note or URL: the signal is refused whole; nothing is stored, logged or echoed.
- **Taxonomy changes**: a new taxonomy version applies to new signals; existing signals keep the version they were recorded under and remain valid; a type that is retired cannot be used for new signals but stays readable.
- **Account merged into another (feature 002)**: signals follow the surviving account and keep their original account reference in history.
- **Contact erased or leaves the account**: the signal stays linked to the account; the contact reference is cleared on erasure, without erasing the account-level observation.
- **Withdrawn or edited source content**: later changes at the source do not rewrite the stored signal; a new signal records the change.
- **Retention expiry**: a signal past its retention policy is removed or reduced to a bare citation according to policy, and the removal is audited.
- **Very long observation text or an oversize import**: refused with a clear message; nothing partial is stored.

## Requirements *(mandatory)*

### Functional Requirements

**Recording signals**

- **FR-001**: The system MUST let an authorised person record a signal for an account, optionally linked to a contact at that account, either by hand or through a provider interface, and both routes MUST apply identical validation.
- **FR-002**: A signal MUST have a source (a source or provider name plus a URL or other identifier). A signal without a source MUST be refused with a specific message and MUST NOT be saved.
- **FR-003**: A signal MUST have a type from the current taxonomy version, and the taxonomy version it was recorded under MUST be stored on it.
- **FR-004**: The taxonomy MUST be versioned and MUST contain nine categories: A organisation/program, B interoperability, C operational data quality, D data platform/architecture, E procurement/funding, F hiring/capability gap, G executive/stakeholder change, H regulatory/ecosystem context, I first-party Netspective. Category I types MUST exist now even though first-party ingestion is a later feature.
- **FR-005**: A signal MUST describe an observation only. No field of a signal MAY express ICP fit, a hypothesis, intent, a buyer decision or a recommendation; observation text that reads like a conclusion MUST still be treated and shown as observation.
- **FR-006**: Recording a signal MUST be refused if the account is unknown, the type is unknown or retired, or the named contact does not have a relationship with that account.

**Provenance**

- **FR-007**: Every signal MUST store these provenance fields: source or provider; URL or identifier; permitted short excerpt (or the reason it was withheld); normalised observation; observed date, collected date and published date (published may be "unknown"); reliability; extraction method; extraction confidence; relevance to ICP, service capability and offer; freshness policy; supporting and contradictory evidence links; evidence status; review status; AI model and prompt version (when AI was used); provenance chain; retention policy; and sensitivity classification.
- **FR-008**: Each signal MUST carry exactly one evidence status from: observed, buyer-confirmed, derived interpretation, AI hypothesis, unverified assumption, contradictory. Repetition, restatement or summarising MUST NOT upgrade a status.
- **FR-009**: Only a person MAY record a signal as buyer-confirmed, only when its source is a buyer statement. An AI actor or a provider MUST NOT set buyer-confirmed, raise reliability, or confirm any fact.
- **FR-010**: Reliability MUST be one of high, medium, low or unknown, defined as: high = an official publication or a buyer's own statement; medium = a reputable third party or an analyst's direct observation; low = unattributed, secondary or inferred; unknown = not rated (never read as low or high). The source kind sets the default; a reviewer MAY change it for a signal with a recorded reason, and an AI actor or provider MUST NOT. Extraction confidence MUST use low, medium or high bands (no false precision). Both MUST be recorded with the signal, and the definitions MUST be shown wherever the values appear.
- **FR-011**: Relevance to ICP, service capability and offer MUST be recorded as tags that help find signals; they MUST be advisory and MUST NOT change ICP fit, eligibility or any rule result.
- **FR-012**: The supporting and contradictory evidence lists MUST always be present on a signal, even when empty. A link to evidence MUST name its role (supporting or contradictory).
- **FR-013**: The provenance chain MUST record, for the signal and for each merge or review, who or what acted, when, by which method, and from which source.
- **FR-014**: The signal's sensitivity classification MUST be one of the permitted data classifications and MUST NEVER be `prohibited`.
- **FR-015**: Every signal MUST have a retention policy, and a signal past its retention MUST be removed or reduced to a bare citation by rule, with the action audited.

**PHI and excerpt limits**

- **FR-016**: Every text field of a signal (excerpt, observation, notes, identifiers, URLs) MUST pass the PHI boundary guard before anything is stored, logged or echoed. A signal that triggers it MUST be refused whole, with an audit event that carries rule identifiers only.
- **FR-017**: An excerpt longer than the permitted length MUST NOT be stored. The global limit is configurable and is a hard ceiling; a source MAY set a shorter limit (down to none) but never a longer one, and the effective limit for a signal is the shorter of the two. The signal MUST keep its citation and normalised observation and record that the excerpt was withheld because it was too long.
- **FR-018**: A source marked "no storage" MUST NOT have any excerpt stored. The signal MUST keep its citation and observation and record that the excerpt was withheld because the source does not permit storage.
- **FR-019**: Sources MUST be recorded once and reused, each with a name, kind, default reliability and a storage rule (excerpt permitted up to a stated length no greater than the global limit, or citation only).

**De-duplication**

- **FR-020**: When a new signal has the same account, type and source as an existing one and its content overlaps (using a deterministic content fingerprint plus a similarity check), the system MUST merge it into the existing signal and MUST NOT create a second signal.
- **FR-021**: Submitting an identical signal again MUST change nothing and MUST report that it already exists (idempotent).
- **FR-022**: A merge MUST add an entry to the provenance chain, MUST keep the original observed date, and MUST NOT lose any information from either side.
- **FR-023**: The same underlying item recorded from two sources (for example one RFP on two portals) MUST be held as one signal with both sources recorded, and MUST count as one independent source when corroboration is assessed.
- **FR-024**: A merge into an already-approved signal MUST keep it approved, MUST NOT change its observation text, MUST appear in its history, and MUST flag the signal "new provenance since review" until a reviewer clears the flag (the clearing is recorded). A flagged approved signal still counts as current evidence.

**Review and the feed**

- **FR-025**: A person with review permission MUST be able to approve a signal, reject it with a reason, or mark it contradictory (naming the signal it contradicts). Each decision MUST record who, when and why, MUST leave the observation unchanged, and MUST be kept in history (a changed mind adds an entry).
- **FR-026**: A rejection MUST require a reason. A rejected signal MUST be excluded from current evidence and kept in history.
- **FR-027**: Contradictory signals of any reliability, including equal reliability, MUST both be kept and flagged; the system MUST NOT choose between them, and MUST present them together for a person to decide.
- **FR-028**: The Signal Feed MUST be filterable by type, ICP, organisation, source, capability, offer, confidence, freshness and review status, singly or combined, and MUST show review status, freshness and evidence status for every signal.
- **FR-029**: Unreviewed signals MUST be visible in the feed and on the account, MUST be labelled "pending review", and MUST NOT count as current evidence, whether a person, an AI or a provider entered them. A signal counts only after a reviewer approves it.
- **FR-030**: Viewing, recording and reviewing MUST each be permission-controlled; refusals MUST be audited. Only technical SME reviewers and administrators MAY review (approve, reject, mark contradictory, re-verify), and they MAY review signals they recorded themselves; every review decision is attributed and audited. The rest of the role-to-permission mapping is a hypothesis recorded for confirmation.

**Freshness and current evidence**

- **FR-031**: Each signal type MUST have a freshness policy (a window in days) defined in the taxonomy, configurable and shown as a hypothesis until measured. "Configurable" means an administrator publishes a new taxonomy version with changed windows; signals already recorded keep the version and window they were recorded under.
- **FR-032**: A signal past its window MUST be flagged stale and MUST NOT count as current evidence; it MUST stay viewable in history.
- **FR-033**: "Current evidence" for an account MUST mean signals that are approved, within their freshness window, and neither rejected nor held in an undecided contradiction.
- **FR-034**: Freshness MUST be decided by a deterministic rule and MUST give identical results for identical inputs and date. For an undated source, freshness MUST run from the collection date and the signal MUST be flagged undated.

**Funding and regulatory rules**

- **FR-035**: A funding signal (category E) MUST be stored as funding context by default. It MAY be classified budget-approval evidence only when the source explicitly states that a budget was approved and that statement is cited in the signal.
- **FR-036**: No signal MAY set, imply or store a "funding path confirmed" value. A grant announcement alone MUST never lead to one.
- **FR-037**: A regulatory or ecosystem signal (category H) MUST be tagged context-only and MUST carry a "re-verify before external use" flag, removable only by a recorded reviewer re-verification against the source.
- **FR-038**: A regulatory signal's rule status MUST be one of proposed, unverified or reported-as-final-by-source. The system MUST NOT state compliance or non-compliance of any organisation. HTI-5 MUST NEVER be recorded as final, and an attempt to do so MUST be refused.
- **FR-039**: A regulatory signal MUST answer "can this be used outside the team?" with "not without re-verification" until re-verified.

**Cross-cutting**

- **FR-040**: Every state change in this feature (recording, merging, review decisions, re-verification, source changes, retention actions) and every refused action MUST produce an audit event with actor, action, entity, before/after summary, time and correlation ID, per the foundation's audit rules.
- **FR-041**: The feature MUST announce, for later features to react to, that a signal was discovered (recorded or merged) and that it was reviewed (recording and normalisation are one step in this feature, so there is no separate "normalised" event; the name stays reserved for feature 004), using identifiers only and no excerpt or observation text.
- **FR-042**: The existing minimal evidence references from feature 002 MUST continue to work, and MUST be convertible to or linkable with signals without changing any 002 rule; signals MUST NOT weaken the economic-buyer confirmation rule.
- **FR-043**: No requirement of this feature may involve patient information, credentials or other prohibited content; the system MUST NOT accept such content in any field.

### Key Entities *(include if feature involves data)*

- **Taxonomy version**: A numbered release of the signal-type list, with date and approver. New signals are recorded under the current version; old signals keep theirs.
- **Signal type**: One kind of signal within a category (A–I), with its default freshness window, default reliability, whether it is context-only, and whether it is funding or regulatory in nature. Belongs to a taxonomy version.
- **Signal source**: A named origin (a publication, portal, provider, buyer statement or first-party channel) with a default reliability and a storage rule (excerpt permitted, or citation only), plus availability (available, or unavailable since a date).
- **Signal**: One observation about an account (and optionally a contact): type, taxonomy version, normalised observation, excerpt or the reason it was withheld, source and identifier, observed/collected/published dates, reliability, extraction method and confidence, relevance tags, evidence status, review status, freshness state, retention policy, sensitivity classification, and flags (stale, undated, context-only, re-verify, new provenance since review).
- **Provenance entry**: One step in a signal's chain: first recorded, merged duplicate, reviewed, re-verified, source became unavailable; with who or what, when, and how.
- **Evidence link**: A connection from a conclusion-holding record in another feature (or another signal) to a signal, with a role: supporting or contradictory.
- **Signal review**: One decision on a signal (approved, rejected, contradictory) with reviewer, time, reason and, for contradictions, the signal it conflicts with. Append-only.
- **Evidence artifact**: Metadata about a stored item behind a signal (for example an uploaded document or captured page): its location, classification and retention, never patient content.
- **Freshness policy**: The window and rule by which a signal type goes stale.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of signal submissions without a source are refused, and 100% of saved signals show a source, a type and the taxonomy version they were recorded under.
- **SC-002**: Submitting the same signal again, any number of times, creates 0 new signals and 0 changes; a lightly reworded near-duplicate from the same source and account merges into the existing signal in 100% of test cases.
- **SC-003**: The same item recorded from two portals is held as 1 signal and counted as 1 independent source in 100% of test cases.
- **SC-004**: 100% of signals past their type's freshness window are excluded from current evidence and still viewable in history; evaluating freshness twice on the same inputs gives identical results.
- **SC-005**: 100% of text fields containing synthetic PHI-like patterns are refused with nothing stored, logged or echoed; 100% of audit events from such refusals carry rule identifiers only.
- **SC-006**: 100% of excerpts over the permitted length, and of excerpts from "no storage" sources, are not stored, and the signal still shows a usable citation.
- **SC-007**: 0 signals ever set or imply a "funding path confirmed" value; 100% of grant announcements are stored as funding context.
- **SC-008**: 100% of regulatory signals carry the context-only tag and the re-verify flag until a reviewer re-verifies them; 0 signals record HTI-5 as final.
- **SC-009**: 0 AI actors or providers can record a buyer-confirmed status or raise reliability, across all tests.
- **SC-010**: A reviewer can find a specific signal using the feed filters and record a decision on it in under 1 minute, and applying any combination of filters returns results in under 2 seconds for 10,000 signals.
- **SC-011**: 100% of state changes and refused actions in this feature produce an audit event, and none contains excerpt or observation text.
- **SC-012**: For the synthetic organisation `lakeshore-hie`, two conflicting public signals of equal reliability are both kept, both flagged contradictory, and neither is selected without a human decision.

## Assumptions

- **Dependencies**: Builds on feature 001 (sign-in, roles, audit, PHI guard, jobs, correlation IDs) and feature 002 (accounts, contacts, and the minimal evidence reference). It does not depend on features 004 to 013.
- **Source description gap**: The prompt refers to "source §8" and "§8.1/§8.2" of the business source. Those sections are not in the repository (only the runbook is). The category list and provenance field list are taken from the prompt itself. The initial signal types below are hypotheses to be checked against the original source (open question #35).
- **Initial signal types** (hypothesis, to confirm): A organisation profile fact, program announcement; B multi-format sender observed, implementation-guide change, onboarding delay; C data quality issue, rejection volume; D platform or architecture change; E procurement notice (RFP), grant or funding announcement, budget-approval statement; F capability-gap hiring; G executive or stakeholder change; H regulatory or ecosystem item (CMS-0057-F, TEFCA, RHTP, implementation-guide change); I lead-magnet download, form submission, workshop or meeting note. Category I types are definitions only here; the feeds that create them are feature 010.
- **Freshness windows** (hypotheses, configurable per type; open question #36): A 365 days; B 180; C 180; D 365; E 120; F 90; G 180; H 365 (context-only); I 90.
- **Reliability scale** (clarified 2026-11-17; per-source-kind defaults remain a hypothesis, open question #35): high, medium, low, unknown as defined in FR-010. Extraction confidence: low, medium, high.
- **Excerpt limit** (global default hypothesis; per-source tightening clarified 2026-11-17; open question #37): 300 characters, configurable; a source may set a shorter limit or none ("no storage"), never a longer one.
- **Current evidence** (clarified 2026-11-17): approved by a reviewer, within its window, not rejected, and not in an undecided contradiction. Unreviewed signals are visible (labelled "pending review") but never counted.
- **Permissions** (review roles clarified 2026-11-17; the rest a hypothesis, open question #38): research analysts and GTM operators record signals; technical SME reviewers and administrators review (approve, reject, mark contradictory, re-verify), including their own signals; sales/service leads and read-only executives can view; AI and provider actors can only submit signals as unreviewed with evidence status below buyer-confirmed.
- **Duplicate detection** (hypothesis): same account, type and source plus a matching normalised-content fingerprint or a similarity above a configurable threshold; the same item from different sources is recognised by a shared identifier (for example the same notice number) or matching content, and then held as one signal with both sources.
- **Retention** (hypothesis): follows the foundation's retention configuration; signals default to the business-record period, citation-only signals are kept as long as the account.
- **Data boundary**: only non-PHI business information; patient or credential data is never accepted in any field.
- **Account signal timeline**: the per-account timeline of signals is a reusable view of the same data as the feed (filtered to one organisation, chronological); mounting it on the account detail screen belongs to feature 002's screens.
- **Contact dependency**: checks that a contact belongs to the account, and clearing the contact link on erasure, rely on feature 002's contact relationships and erasure.
- **Out of scope**: automated web research and hypotheses (004), first-party event ingestion pipelines (010), qualification facts such as funding path status and economic buyer (008), claims governance (005), and any conclusion drawn from signals (ICP fit stays in 002).
