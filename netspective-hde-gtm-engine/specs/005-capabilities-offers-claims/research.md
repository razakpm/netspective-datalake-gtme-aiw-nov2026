# Research: Service Capabilities, Offer Catalog and Claims

Decisions taken in planning. Numeric and structural defaults are **hypotheses** unless stated, and are tracked in open question #48. Every decision lists what was weighed.

## R-01 Module boundaries (recorded as ADR-019)

**Decision**: Three modules in `apps/api/src/modules`: `claims`, `capabilities`, `offers`. `claims` is its own module and does not live inside `content`. `offers` and `capabilities` depend on the public index of `claims` (coverage check, evidence link) and never the reverse. Feature 009 (`content`) will also depend on `claims` and on the pure claim checker.

**Rationale**: Feature 009 depends on 005, so putting claims inside `content` would make offers depend on a module that is built later, or force a cycle. Claims are used by offers now and by content later; a neutral module keeps the dependency one-way. This matches the modular-monolith rule (constitution XVI): talk through public indexes, events for the rest.

**Alternatives**: claims inside `content` (rejected: cycle with 009); one `catalogue` module for all three (rejected: claims has a different approver set, audit trail and release cadence).

## R-02 Seed content and the approved-seed conflict

**Decision**: The business source for the 19 capabilities, ten offers and scoring table is not in the repository (open question #47). The seed migration holds only facts recorded in the repository: Offers 1, 5, 6 (names, formats, routing, SQL rules from the guardrails), Offer 7's limitation text, Offer 8 as the Resilience Review offer, and the three paid engagement types with the scope details in the spec. Capabilities are 19 slots `capability-01` to `capability-19` with every attribute null. Offers 2, 3, 4, 7, 8, 9, 10 are rows with a key and null attributes. A **null attribute is the "to be provided" placeholder**; there is no sentinel string.

Spec FR-012 seeds Offers 1, 5 and 6 as approved but also forbids moving an offer with a placeholder to approved. These conflict, because the repository does not hold every attribute of Offers 1, 5 and 6 (landing-page promise, call to action, intake fields). **Resolution**: the seed migration records the three offers as `approved` once, as a baseline decision by the actor `seed` with a note, and the placeholder gate applies to every later move made by a person. The three offers show a "baseline, attributes incomplete" notice until a person fills the nulls. They are not seeded `available`.

**Rationale**: Honest and reversible: nothing is invented, the gate still protects every new move, and the seed is auditable. Putting 004's provisional capability keys into the slots was rejected: that list is a hypothesis of feature 004, not source content, and this branch does not contain it. Feature 004 keeps its provisional list until names exist (a later task switches it to read this catalogue).

**Alternatives**: seed Offers 1, 5, 6 as `internally_reviewed` (rejected: contradicts the spec); invent plausible attribute text (rejected: violates the "do not invent" rule).

## R-03 Offer versions and per-version status

**Decision**: `engagement_offer` is the head (key, number, pointers). Each change creates an immutable `offer_version` (content snapshot as JSON, hash, number, author, reason). Status belongs to a **version**, kept as append-only `offer_version_status` rows (draft → internally_reviewed → approved → available; withdrawn and expired from approved or available). `engagement_offer.in_force_version_no` points at the latest version that is approved or available; `latest_version_no` at the newest. A new version after approval starts at draft and must be reviewed again; the earlier approved version stays in force until the new one is approved, at which point it is shown as superseded (derived, not a status). Withdrawn and expired apply to the offer by acting on its in-force version.

**Rationale**: Spec edge case "approved offer needs a correction". A single offer-level status would either block corrections or silently change what is approved.

**Alternatives**: offer-level status only (rejected: cannot express "old version in force while new is reviewed"); mutate the version in place (rejected: violates immutability).

## R-04 Gates on moving a version to approved or available

**Decision**: One pure function `evaluateOfferGate` in `packages/domain/src/offers/gate.ts` returns refusal codes. Moving to `approved` or `available` is refused when: any required attribute is null (`placeholder_attributes`); an active limitation has no valid acknowledgement (`limitation_unacknowledged`); the claim checker finds a restricted phrase in a public field not covered by an approved claim (`uncovered_restricted_phrase`). Public fields are landing-page promise, call to action, buyer output and conversion path. Moves to `internally_reviewed`, `withdrawn` and `expired` have no gate beyond the transition order.

A flag is **covered** when the whole sentence containing the match, after normalisation, equals the text of an approved, unexpired claim of the same class. A flag may also be dismissed as a false positive for that exact sentence by a designated approver (R-07).

**Rationale**: Deterministic and testable (principle IX); exact-sentence cover avoids a loose "any claim exists" bypass.

**Alternatives**: substring cover (rejected: lets an approved claim excuse longer unapproved text); gate only at `available` (rejected: approval would mean nothing).

## R-05 Limitations and acknowledgement

**Decision**: `offer_limitation` rows (offer, key, wording, active) and append-only `offer_limitation_ack` (limitation, wording hash, service lead, time). An acknowledgement is valid while the wording hash is unchanged; changing the wording makes it stale. Offer 7's limitation "evaluation is a buyer prompt only" is seeded active and unacknowledged. Acknowledging requires the `offers.limitations.acknowledge` permission, held by the service lead role.

**Alternatives**: a boolean flag on the offer (rejected: no who or when, survives wording changes).

## R-06 The claim checker (pure)

**Decision**: `packages/domain/src/claims/{linter,phrases,normalise,types}.ts`. `lintText(text, list)` returns matches `{ class, rule, start, end, text }` and never calls a model or I/O. The list is data (`RestrictedPhraseList`) passed in, with a default list in code that seeds version 1. Normalisation: NFKC, case folding, unify hyphen, dash and non-breaking-space variants, collapse runs of spaces. Rules are one of: **phrase** (case-insensitive, whole-word boundaries, tolerant of hyphen or space: "AI-ready", "AI ready"), **acronym** (case-sensitive whole token: SLA, RTO, RPO, SOC 2, SOC2, so "slate" never matches), **pattern** (regex), and **outcome percentage** (a number with `%` within five words of an outcome term such as reduce, improve, increase, faster, uptime, save, cut, so "page 50%" does not match). The default list covers the eight restricted classes from the spec, including "guarantee", "HIPAA compliant", "SOC 2", "AI-ready", SLA and RTO, "production-ready", "multi-tenant isolation" and "certified". Customer identity cannot be matched by words; it is covered by the internal-only classification of delivery examples (R-10) and by the PHI guard.

The list is versioned configuration in `restricted_phrase_list` (immutable versions with owner and reviewer). A test corpus in `tests/fixtures/claims/corpus.json` (positive and negative cases, with expected class and position) is the acceptance test.

**Rationale**: Matches principle IX and scenario E; list as data makes ownership and review (FR-006) real.

**Alternatives**: regex only (rejected: hard to review for non-engineers); stemming or fuzzy matching (rejected: false positives, and not deterministic across versions).

## R-07 Claims, evidence and two-person review

**Decision**: `claim` (text, declared class, status draft, in_review, approved, rejected, withdrawn; `needs_review` is computed at read and not stored), `claim_evidence` (kind, reference, owner, expires_at, withdrawn_at), append-only `claim_review` (decision: approve, reject; reviewer; note), and append-only `lint_disposition` (sentence hash, rule, reason, reviewer). The claim's class is the **union of the declared class and any class the checker finds**; it cannot be lowered below what the checker finds. A non-restricted claim needs evidence and one approval. A restricted claim needs evidence and approvals from two different designated approvers, neither being the drafter; any rejection stops it. Evidence that is withdrawn or past expiry makes the claim `needs_review` **at read time** (computed, as feature 004 does for staleness); an optional daily job materialises it and emits `claim.needs_review`. Default is omission: only `approved` claims can cover text.

**Alternatives**: counting approvals in a column (rejected: not auditable); one approver for all (rejected: spec requires two for restricted).

## R-08 Capacity: limits, bookings, computed usage

**Decision**: `offer_capacity` rows are the **limit history** (offer, period kind week or month, limit, effective_from, set_by; append-only, latest effective wins). `offer_session_booking` rows are the usage source (offer, external reference, state booked, held, cancelled, no_show, period start, source manual or workshop, who). Usage is **computed**: booked sessions in the period (state booked, held or no_show) per FR-020; held count is reported separately. Periods are calendar weeks from Monday and calendar months in `BUSINESS_TIME_ZONE` (default `UTC`, hypothesis, open question #48). Pure functions in `packages/domain/src/offers/capacity.ts` (`periodFor`, `usage`, `status`) with table tests for month and week edges, daylight-saving changes and rescheduling.

Feature 006 queries the **public function** `capacityStatus(offerId, at)` from the offers module index, which returns `room`, `exhausted` or `no_limit_set` with limit, used, remaining and period bounds, and the same data through `GET /v1/offers/{id}/capacity/status`. Feature 007 will call `recordBooking`, `rescheduleBooking` and `cancelBooking` from the same index; until then a delivery lead enters bookings by hand (labelled manual). A booking into a full period, or a reschedule into one, is refused with `capacity_exhausted`; there is no override in this feature.

**Rationale**: The runbook lists `used` as a column "computed from workshop bookings in 007"; storing a counter drifts. Computing from bookings keeps one source of truth and makes release on cancel automatic.

**Deviation recorded**: no stored `used` column.

**Alternatives**: counter column (rejected: drift, races); counting held only (rejected by clarification).

## R-09 Offer scores

**Decision**: `offer_score_criterion` (key, label, order) and append-only `offer_score` (offer, criterion, score, status always `hypothesis`, rationale, set_by, time); current score is the latest. The criteria and scores come from the business source §6.2, which is not in the repository, so the seed has **no criteria** and the screen shows "to be provided". Scores are judgement integers on a configured scale (default 1 to 5, hypothesis).

**Alternatives**: invent criteria (rejected); store scores in the offer snapshot (rejected: scores change on a different cadence from offer content and need their own history).

## R-10 Capabilities, evidence and internal delivery examples

**Decision**: `service_capability` (slot key, name, description, input types, output types, buyer problems, limitations, required expertise, potential paid engagement, public-claim status), `capability_evidence` (basis kind, reference, note), `capability_delivery_example` (text, internal only), and link tables to offers. Multi-valued fields are JSON arrays validated by schema. Delivery examples are classified `internal_case_study_restricted`; the API returns them only to callers with `capabilities.examples.read`, and one **public projection** function builds every outward-facing capability view without them (a unit test proves no example text can reach it). Marking a capability `approved` for public claims needs a recorded evidence basis, no null attributes and an approved claim. Every example text goes through the PHI guard.

**Alternatives**: examples as a free-text column on the capability (rejected: easy to leak in a list response).

## R-11 Paid engagement types and deliverables

**Decision**: `paid_engagement_type` (key, name, min and max weeks, scope text list, status active or inactive, scope_confirmed flag) and `paid_engagement_deliverable` (type, text, in_source boolean, approval state, approver). Seeded from the spec: Sender Readiness Sprint (6 weeks, 3 to 5 senders, one format, per-sender rejection reporting, header contract, raw-first landing), Input Audit (6 to 8 weeks, one use case, 1 to 2 sources, lineage-tracked feed, go/no-go memo), Resilience Review (inactive, scope "to be confirmed"). **There is no price, fee, rate or currency column**, and a schema test fails the build if any column name matches those words on this table or any table of this feature. A new deliverable not in the source starts `pending_approval` and is rejected from use until approved with the restricted `paid_types.approve` permission.

**Alternatives**: a free-form JSON scope (rejected: cannot enforce the no-price rule or the approval).

## R-12 Permissions and roles

**Decision**: New permissions: `capabilities.read`, `capabilities.edit`, `capabilities.examples.read`, `offers.read`, `offers.edit`, `offers.status.change`, `offers.limitations.acknowledge`, `offers.capacity.edit`, `offers.bookings.edit`, `claims.read`, `claims.draft`, `claims.approve` (restricted: ends in `.approve`), `claims.phrases.manage`, `paid_types.edit`, `paid_types.approve` (restricted). Role mapping (hypothesis, open question #48): `sales_service_lead` gets capabilities, offers, limitation acknowledgement, capacity, bookings, paid types edit, and `claims.approve` and `paid_types.approve`; `campaign_approver` (the marketing approver) gets `claims.read`, `claims.draft`, `claims.approve`, `claims.phrases.manage`; analysts and operators read the catalogue and draft claims; the executive reads. There is no separate "delivery lead" role, so capacity belongs to `sales_service_lead` until one exists. **Designated approver** means a person holding `claims.approve` through an active role; AI and service actors cannot hold it (existing restriction rule).

**Alternatives**: a separate designation table (rejected for now: duplicates roles; revisit if the approver set must differ from the role).

## R-13 Concurrency, idempotency, audit and events

**Decision**: Writes that create a version or change a record take `expectedVersion`; a stale value returns 409 `stale_version` (edge case "two people edit at once"). Mutating routes require an `Idempotency-Key` using the existing helpers (`runIdempotentAsync` where the service owns its transaction). Every change, status move, approval, refusal and capacity change writes an audit event in the same transaction. Events (identifiers only, strict schemas): `capability.updated`, `offer.updated` (change: version, status, limitation, score), `offer.capacity.changed`, `claim.created`, `claim.reviewed`, `claim.needs_review`. No claim text, offer text, note or example text appears in any event or log.

## R-14 Migrations and branch dependency

**Decision**: Migrations `0017_claims.sql`, `0018_offers.sql`, `0019_capabilities.sql`, forward-only, following feature 004's `0014` to `0016`, which are already on `main`. Immutability is enforced by database triggers that refuse UPDATE and DELETE on `offer_version`, `offer_version_status`, `offer_limitation_ack`, `claim_review`, `lint_disposition`, `offer_capacity`, `offer_score`, `restricted_phrase_list` versions. All new columns are registered in `COLUMN_CLASSIFICATION`. Feature 004 is already merged into `main` (PR #10), so no rebase or renumbering is needed; the shared files (permissions, seeds, classification, composition root) are the places a later feature may conflict.

## R-15 UI

**Decision**: Three screens under existing patterns: **Offer Workspace v1** (`/offers`, list with status, capacity utilisation and placeholder notices; detail with version history, limitations, scores, status actions), **Capability catalogue** (`/capabilities`), **Claim review queue** (`/claims`, claims by status, evidence, checker results, approve and reject controls shown only to approvers). Controls are hidden without the permission, every refusal has a plain message, and free-text fields show the PHI warning. Navigation entries are gated by permission.

## R-16 Configuration

**Decision**: `BUSINESS_TIME_ZONE` (default `UTC`), `OFFER_SCORE_MIN` and `OFFER_SCORE_MAX` (default 1 and 5), `CLAIM_EVIDENCE_DEFAULT_EXPIRY_MONTHS` (default 12; evidence with no stated expiry uses it), all hypotheses, in `.env.example` and the config module. No secrets.
