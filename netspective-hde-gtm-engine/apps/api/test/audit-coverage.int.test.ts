import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_PHRASE_RULES, FOUNDATION_ROLE_PERMISSIONS, RULE_SET_V1 } from "@gtm/domain";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// SC-002 and FR-010/011 across ALL routes (task T055). The route list comes from Fastify's registry, so
// a state-changing route added without an entry in DRIVERS fails this test.

let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

let seq = 0;
const target = (fx: IdentityFixture) =>
  fx.makeUser(`target${seq++}@example.org`, ["gtm_operator"]).then((u) => u.id);

interface Call {
  url: string;
  payload?: unknown;
  contentType?: string;
  /** Role used for the forbidden attempt when gtm_operator is itself allowed on the route. */
  forbiddenRole?: "read_only_executive";
  /** Success audit events one call writes (default 1; starting a run also records the queued job). */
  successEvents?: number;
}

const DRIVERS: Record<string, (fx: IdentityFixture) => Promise<Call>> = {
  "POST /api/v1/users": async () => ({
    url: "/api/v1/users",
    payload: { email: "invited@example.org" },
  }),
  "PUT /api/v1/users/:userId/roles": async (f) => ({
    url: `/api/v1/users/${await target(f)}/roles`,
    payload: { roles: ["research_analyst"] },
  }),
  "POST /api/v1/users/:userId/deactivate": async (f) => ({
    url: `/api/v1/users/${await target(f)}/deactivate`,
  }),
  "POST /api/v1/users/:userId/reactivate": async (f) => {
    const id = await target(f);
    f.db.raw.prepare("UPDATE \"user\" SET status = 'deactivated' WHERE id = ?").run(id);
    return { url: `/api/v1/users/${id}/reactivate` };
  },
};

const held = (f: IdentityFixture) =>
  f.db.transaction((tx) =>
    f.quarantine.hold(tx, {
      entryPoint: "api_body",
      content: "synthetic held content",
      ruleIds: ["PHI.SSN"],
      guardVersion: "test",
    }),
  );
DRIVERS["POST /api/v1/quarantine-items/:id/content"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/content`,
  payload: { purpose: "coverage check" },
});
DRIVERS["POST /api/v1/quarantine-items/:id/release"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/release`,
  payload: { reason: "coverage check" },
});
DRIVERS["POST /api/v1/quarantine-items/:id/discard"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/discard`,
  payload: { reason: "coverage check" },
});

let accountSeq = 0;
function makeAccount(f: IdentityFixture): string {
  const id = `acct-${accountSeq++}`;
  const now = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(id, `Coverage ${id}`, `coverage ${id}`, now, now);
  f.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
    )
    .run(`cls-${id}`, id, "health_system", now);
  f.db.raw
    .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
    .run(`dom-${id}`, id, `${id}.example`, now);
  return id;
}

// Feature 002 routes. gtm_operator may use these, so the forbidden attempt uses a read-only role.
DRIVERS["POST /api/v1/accounts/import"] = async () => ({
  // A single invalid row: no account events, so the run summary is the one audit event.
  url: "/api/v1/accounts/import",
  contentType: "text/csv",
  payload: "name,type\n,health_system\n",
  forbiddenRole: "read_only_executive",
});
DRIVERS["PATCH /api/v1/accounts/:id"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}`,
  payload: { geography: "Coverage region" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["PUT /api/v1/accounts/:id/domains/:domain/shared"] = async (f) => {
  const id = makeAccount(f);
  return {
    url: `/api/v1/accounts/${id}/domains/${id}.example/shared`,
    payload: { shared: true },
    forbiddenRole: "read_only_executive",
  };
};
DRIVERS["POST /api/v1/review-items/:id/decision"] = async (f) => {
  const a = makeAccount(f);
  const b = makeAccount(f);
  const id = `review-${a}`;
  f.db.raw
    .prepare(
      `INSERT INTO review_item (id, kind, subject_a, subject_b, reason_codes, pair_key,
         attribute_fingerprint, state, proposed_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, "merge_candidate", a, b, "[]", `${a}:${b}`, "fp", "open", new Date().toISOString());
  return {
    url: `/api/v1/review-items/${id}/decision`,
    payload: { decision: "reject", reason: "coverage check" },
    forbiddenRole: "read_only_executive",
  };
};

// Feature 003 routes (signals, review, sources).
const signalActor = () => ({
  userId: "driver-user",
  actorType: "human" as const,
  correlationId: null,
});
let signalSeq = 0;
function makeSignal(f: IdentityFixture): string {
  return f.signals.record(signalActor(), {
    accountId: makeAccount(f),
    typeKey: "program_announcement",
    source: {
      sourceId: "default-source-official_publication",
      ref: "https://example.org/coverage",
    },
    observation: `Coverage signal ${signalSeq++} observation text`,
    observedAt: new Date().toISOString(),
  }).signal.id;
}
DRIVERS["POST /api/v1/signals"] = async (f) => ({
  url: "/api/v1/signals",
  payload: {
    accountId: makeAccount(f),
    typeKey: "program_announcement",
    source: { sourceId: "default-source-official_publication", ref: "https://example.org/driver" },
    observation: "A program was announced for coverage",
    observedAt: new Date().toISOString(),
  },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/signals/:id/review"] = async (f) => ({
  url: `/api/v1/signals/${makeSignal(f)}/review`,
  payload: { decision: "approve" },
});
DRIVERS["POST /api/v1/signal-sources"] = async () => ({
  url: "/api/v1/signal-sources",
  payload: { name: "Coverage source", kind: "third_party" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["PATCH /api/v1/signal-sources/:id"] = async () => ({
  url: "/api/v1/signal-sources/default-source-official_publication",
  payload: { excerptMaxChars: 100 },
});
DRIVERS["PUT /api/v1/signal-sources/:id/availability"] = async () => ({
  url: "/api/v1/signal-sources/default-source-third_party/availability",
  payload: { available: false },
});

// Feature 004 routes (research, interpretation, source rules, hypotheses).
const human = () => ({ userId: "driver-user", actorType: "human" as const, correlationId: null });
const driverSignal = (f: IdentityFixture, accountId: string) => {
  const n = signalSeq++;
  // A distinct inline source per signal keeps near-identical driver texts from merging into one signal.
  return f.signals.record(human(), {
    accountId,
    typeKey: "onboarding_delay",
    source: { name: `Driver source ${n}`, kind: "other", ref: `https://example.org/driver/${n}` },
    observation: `Driver signal ${n} about onboarding delays`,
    observedAt: new Date().toISOString(),
  }).signal.id;
};
const driverHypothesis = (f: IdentityFixture, accountId = makeAccount(f)) =>
  f.research.hypotheses.create(human(), accountId, {
    statement: "Sender onboarding delays may be slowing intake for this account.",
    category: "onboarding_friction",
    supportingSignalIds: [driverSignal(f, accountId)],
    confidence: { band: "low", explanation: "Driver evidence only." },
  }).id;
const driverProposal = (f: IdentityFixture) => {
  const accountId = makeAccount(f);
  const sig = driverSignal(f, accountId);
  const runId = `run-${accountId}`;
  const at = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros, summary_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(runId, accountId, "u", "manual", "completed", 10, 2000000, "{}", at);
  const id = `prop-${accountId}`;
  f.db.raw
    .prepare(
      "INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, proposed_statement, category, status, confidence_band, confidence_explanation, proposed_by_run_id, ai_model, ai_prompt_version_id, created_at, updated_at) VALUES (?,?,'ai','proposed','A proposed testable statement.','A proposed testable statement.','other',NULL,'low','weak',?,'m','prompt-hypothesis-propose-1.0.0',?,?)",
    )
    .run(id, accountId, runId, at, at);
  f.db.raw
    .prepare(
      "INSERT INTO hypothesis_evidence (id, hypothesis_id, signal_id, role, linked_by_type, linked_at) VALUES (?,?,?,?,'ai',?)",
    )
    .run(`ev-${id}`, id, sig, "supporting", at);
  return id;
};
DRIVERS["POST /api/v1/accounts/:id/research"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}/research`,
  payload: { maxSources: 3 },
  forbiddenRole: "read_only_executive",
  successEvents: 2,
});
DRIVERS["PUT /api/v1/accounts/:id/research/schedule"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}/research/schedule`,
  payload: { enabled: true, cadence: "weekly" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/research-runs/:id/cancel"] = async (f) => ({
  url: `/api/v1/research-runs/${f.research.research.startRun(human(), makeAccount(f), {}).id}/cancel`,
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/research-runs/:id/acknowledge"] = async (f) => {
  const accountId = makeAccount(f);
  const id = `attn-${accountId}`;
  f.db.raw
    .prepare(
      "INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros, created_at) VALUES (?,?,?,?,?,?,?,?)",
    )
    .run(id, accountId, "u", "manual", "needs_attention", 10, 2000000, new Date().toISOString());
  return {
    url: `/api/v1/research-runs/${id}/acknowledge`,
    payload: { note: "Looked at it; keeping it open." },
    forbiddenRole: "read_only_executive",
  };
};
DRIVERS["POST /api/v1/accounts/:id/problem-interpretations"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}/problem-interpretations`,
  payload: {
    statement: "Our pilot worked on demo data but failed on ours, and we cannot tell why.",
  },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/research-sources"] = async () => ({
  url: "/api/v1/research-sources",
  payload: {
    kind: "public_org_site",
    matchType: "host_suffix",
    pattern: `driver-${signalSeq++}.example`,
  },
});
DRIVERS["PATCH /api/v1/research-sources/:id"] = async (f) => {
  const id = `rule-${signalSeq++}`;
  f.db.raw
    .prepare(
      "INSERT INTO research_source_rule (id, kind, match_type, pattern, status, signal_source_kind, created_at) VALUES (?,?,?,?,?,?,?)",
    )
    .run(
      id,
      "public_org_site",
      "host",
      `${id}.example`,
      "enabled",
      "official_publication",
      new Date().toISOString(),
    );
  return { url: `/api/v1/research-sources/${id}`, payload: { status: "disabled" } };
};
DRIVERS["POST /api/v1/accounts/:id/hypotheses"] = async (f) => {
  const accountId = makeAccount(f);
  return {
    url: `/api/v1/accounts/${accountId}/hypotheses`,
    payload: {
      statement: "Sender onboarding delays may be slowing intake for this account.",
      category: "onboarding_friction",
      supportingSignalIds: [driverSignal(f, accountId)],
      confidence: { band: "low", explanation: "Driver evidence only." },
    },
    forbiddenRole: "read_only_executive",
  };
};
DRIVERS["PATCH /api/v1/hypotheses/:id"] = async (f) => ({
  url: `/api/v1/hypotheses/${driverHypothesis(f)}`,
  payload: { statement: "Sender onboarding delays may be slowing intake in several formats." },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/hypotheses/:id/accept"] = async (f) => ({
  url: `/api/v1/hypotheses/${driverProposal(f)}/accept`,
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/hypotheses/:id/dismiss"] = async (f) => ({
  url: `/api/v1/hypotheses/${driverProposal(f)}/dismiss`,
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/hypotheses/:id/evidence"] = async (f) => {
  const accountId = makeAccount(f);
  const id = driverHypothesis(f, accountId);
  return {
    url: `/api/v1/hypotheses/${id}/evidence`,
    payload: { signalId: driverSignal(f, accountId), role: "contradictory" },
    forbiddenRole: "read_only_executive",
  };
};
DRIVERS["POST /api/v1/hypotheses/:id/assumptions"] = async (f) => ({
  url: `/api/v1/hypotheses/${driverHypothesis(f)}/assumptions`,
  payload: { text: "The pilot needs a small set of named fields." },
  forbiddenRole: "read_only_executive",
});

// Feature 005 routes (claims, offers, capacity, scores, paid engagement types, capabilities). The services
// check permissions and audit refusals, so a signed-in reader gets exactly one denied event.
const cat = () => ({
  userId: "coverage-driver",
  actorType: "human" as const,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.administrator,
});
const draftClaim = (f: IdentityFixture, text = "We review sender feeds weekly.") =>
  f.catalogue.claims.draft(cat(), { text }).id;
const claimWithEvidence = (f: IdentityFixture) => {
  const id = draftClaim(f);
  f.catalogue.claims.addEvidence(cat(), id, {
    kind: "document",
    reference: "report-1",
    owner: "Owner",
  });
  return id;
};
const dayToday = () => new Date().toISOString().slice(0, 10);
const reader = { forbiddenRole: "read_only_executive" as const };

DRIVERS["POST /api/v1/claims"] = async () => ({
  url: "/api/v1/claims",
  payload: { text: "We review sender feeds weekly." },
  ...reader,
});
DRIVERS["POST /api/v1/claims/dispositions"] = async () => ({
  url: "/api/v1/claims/dispositions",
  payload: {
    sentence: "Our SOC 2 reading list is public.",
    ruleId: "soc2",
    reason: "A reading list",
  },
  ...reader,
});
DRIVERS["POST /api/v1/claims/:id/evidence"] = async (f) => ({
  url: `/api/v1/claims/${draftClaim(f)}/evidence`,
  payload: { kind: "document", reference: "report-1", owner: "Owner" },
  ...reader,
});
DRIVERS["POST /api/v1/claims/:id/evidence/:evidenceId/withdraw"] = async (f) => {
  const id = claimWithEvidence(f);
  const evidenceId = f.catalogue.claims.get(cat(), id).evidence[0]!.id;
  return { url: `/api/v1/claims/${id}/evidence/${evidenceId}/withdraw`, ...reader };
};
DRIVERS["POST /api/v1/claims/:id/review"] = async (f) => ({
  url: `/api/v1/claims/${claimWithEvidence(f)}/review`,
  payload: { decision: "approve", note: "Checked it" },
  ...reader,
});
DRIVERS["POST /api/v1/claims/:id/withdraw"] = async (f) => ({
  url: `/api/v1/claims/${draftClaim(f)}/withdraw`,
  payload: { note: "No longer needed" },
  ...reader,
});
DRIVERS["PUT /api/v1/restricted-phrases"] = async (f) => ({
  url: "/api/v1/restricted-phrases",
  payload: {
    rules: DEFAULT_PHRASE_RULES,
    reviewerId: (await f.makeUser(`reviewer-${Math.random()}@example.org`, ["sales_service_lead"]))
      .id,
    note: "No change, republish",
  },
  ...reader,
});
DRIVERS["PATCH /api/v1/offers/:id"] = async () => ({
  url: "/api/v1/offers/offer-2",
  payload: { lockNo: 1, reason: "A small change", patch: { name: "Changed name" } },
  ...reader,
});
DRIVERS["POST /api/v1/offers/:id/versions/:versionNo/status"] = async () => ({
  url: "/api/v1/offers/offer-2/versions/1/status",
  payload: { to: "internally_reviewed", note: "Reviewed" },
  ...reader,
});
DRIVERS["POST /api/v1/offers/:id/limitations/:limitationId/acknowledge"] = async () => ({
  url: "/api/v1/offers/offer-7/limitations/limitation-offer-7-evaluation/acknowledge",
  ...reader,
});
DRIVERS["PUT /api/v1/offers/:id/capacity"] = async () => ({
  url: "/api/v1/offers/offer-6/capacity",
  payload: { periodKind: "month", limitSessions: 4, reason: "More room" },
  ...reader,
});
DRIVERS["POST /api/v1/offers/:id/bookings"] = async () => ({
  url: "/api/v1/offers/offer-6/bookings",
  payload: { sessionDate: dayToday() },
  ...reader,
});
DRIVERS["PATCH /api/v1/offers/:id/bookings/:bookingId"] = async (f) => ({
  url: `/api/v1/offers/offer-6/bookings/${f.catalogue.bookings.record(cat(), "offer-6", { sessionDate: dayToday() }).id}`,
  payload: { state: "held" },
  ...reader,
});
DRIVERS["PUT /api/v1/offer-scores"] = async (f) => {
  f.catalogue.scores.addCriterion(cat(), {
    key: "coverage_pull",
    label: "Buyer pull",
    position: 1,
  });
  return {
    url: "/api/v1/offer-scores",
    payload: { offerId: "offer-1", criterionKey: "coverage_pull", score: 3 },
    ...reader,
  };
};
DRIVERS["PATCH /api/v1/paid-engagement-types/:key"] = async () => ({
  url: "/api/v1/paid-engagement-types/input_audit",
  payload: { lockNo: 1, scope: ["one use case"] },
  ...reader,
});
DRIVERS["POST /api/v1/paid-engagement-types/:key/deliverables"] = async () => ({
  url: "/api/v1/paid-engagement-types/input_audit/deliverables",
  payload: { text: "A weekly status call" },
  ...reader,
});
DRIVERS["POST /api/v1/paid-engagement-types/:key/deliverables/:deliverableId/decision"] = async (
  f,
) => {
  const type = f.catalogue.paidTypes.proposeDeliverable(cat(), "input_audit", {
    text: "A weekly status call",
  });
  const id = type.deliverables.find((d) => d.text === "A weekly status call")!.id;
  return {
    url: `/api/v1/paid-engagement-types/input_audit/deliverables/${id}/decision`,
    payload: { decision: "approve", note: "Agreed" },
    ...reader,
  };
};
DRIVERS["PATCH /api/v1/service-capabilities/:id"] = async () => ({
  url: "/api/v1/service-capabilities/capability-01",
  payload: { lockNo: 1, attributes: { name: "Coverage name" } },
  ...reader,
});
DRIVERS["POST /api/v1/service-capabilities/:id/evidence"] = async () => ({
  url: "/api/v1/service-capabilities/capability-01/evidence",
  payload: { basisKind: "delivery_record", reference: "rec-1" },
  ...reader,
});
DRIVERS["POST /api/v1/service-capabilities/:id/delivery-examples"] = async () => ({
  url: "/api/v1/service-capabilities/capability-01/delivery-examples",
  payload: { text: "An internal delivery note" },
  ...reader,
});
DRIVERS["PUT /api/v1/service-capabilities/:id/offers/:offerId"] = async () => ({
  url: "/api/v1/service-capabilities/capability-01/offers/offer-1",
  ...reader,
});
DRIVERS["DELETE /api/v1/service-capabilities/:id/offers/:offerId"] = async (f) => {
  f.catalogue.capabilities.link(cat(), "capability-01", "offer-1");
  return { url: "/api/v1/service-capabilities/capability-01/offers/offer-1", ...reader };
};
DRIVERS["PUT /api/v1/service-capabilities/:id/public-claim-status"] = async (f) => {
  const caps = f.catalogue.capabilities;
  caps.update(cat(), "capability-02", {
    lockNo: 1,
    attributes: {
      name: "Mapping",
      description: "Maps clinical documents to FHIR.",
      inputTypes: ["CCDA"],
      outputTypes: ["FHIR"],
      buyerProblems: ["Unclear mapping"],
      limitations: ["Needs samples"],
      requiredExpertise: "Interoperability engineer",
      potentialPaidTypeKey: "input_audit",
    },
  });
  caps.addEvidence(cat(), "capability-02", { basisKind: "delivery_record", reference: "rec-2" });
  const claimId = "claim-coverage-approved";
  const at = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT INTO claim (id, text, declared_class, effective_class, status, drafted_by, drafted_at, version_no) VALUES (?, 'We map documents to FHIR.', NULL, 'general', 'approved', 'someone', ?, 1)",
    )
    .run(claimId, at);
  f.db.raw
    .prepare(
      "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES ('ev-coverage', ?, 'document', 'doc', 'owner', 'someone', ?, '2099-01-01T00:00:00.000Z')",
    )
    .run(claimId, at);
  return {
    url: "/api/v1/service-capabilities/capability-02/public-claim-status",
    payload: { status: "approved", claimId },
    ...reader,
  };
};

/** Routes that cannot be driven through the fake issuer (none yet; webhook ingress arrives with US5). */
// Feature 006 routes (recommendations and routing rule sets). Operators may recommend, so the forbidden
// attempt for those uses a read-only role; rule set changes are forbidden to operators.
const seedActor = (f: IdentityFixture) => ({
  userId: "seed-lead",
  actorType: "human" as const,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.administrator,
  now: () => f.clock.now,
});
async function pendingRecommendation(f: IdentityFixture): Promise<string> {
  const account = makeAccount(f);
  const r = await f.routing.recommendations.recommend(seedActor(f), { accountId: account });
  return r.id;
}
DRIVERS["POST /api/v1/accounts/:id/offer-recommendations"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}/offer-recommendations`,
  payload: {},
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/offer-recommendations/:id/review"] = async (f) => ({
  url: `/api/v1/offer-recommendations/${await pendingRecommendation(f)}/review`,
  payload: { decision: "dismiss", reason: "Coverage check" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/routing-rule-sets"] = async () => ({
  url: "/api/v1/routing-rule-sets",
  payload: { rules: RULE_SET_V1.rules, reason: "Coverage check" },
});
DRIVERS["POST /api/v1/routing-rule-sets/:version/activate"] = async (f) => {
  const draft = f.routing.ruleSets.createDraft(seedActor(f), {
    rules: RULE_SET_V1,
    reason: "Coverage check",
  });
  return {
    url: `/api/v1/routing-rule-sets/${draft.version}/activate`,
    payload: { reason: "Coverage check" },
  };
};

DRIVERS["POST /api/v1/offers/:id/waitlist"] = async (f) => ({
  url: "/api/v1/offers/offer-6/waitlist",
  payload: { accountId: makeAccount(f), reason: "Offer 6 is full" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/offers/:id/waitlist/:entryId/close"] = async (f) => {
  const entry = f.routing.waitlist.add(seedActor(f), "offer-6", {
    accountId: makeAccount(f),
    reason: "Offer 6 is full",
  });
  return {
    url: `/api/v1/offers/offer-6/waitlist/${entry.id}/close`,
    payload: { state: "released", reason: "A place opened" },
    forbiddenRole: "read_only_executive",
  };
};

// Feature 006: the request inbox and notice versions. Operators review; marketing approvers handle notices.
let requestSeq = 0;
function makeRequest(f: IdentityFixture): string {
  const id = `request-${requestSeq++}`;
  const offer = (
    f.db.raw.prepare("SELECT id FROM engagement_offer WHERE number = 5").get() as { id: string }
  ).id;
  f.db.raw
    .prepare(
      "INSERT INTO offer_request (id, offer_id, form_slug, kind, email_hash, submitted_at) VALUES (?,?,?,?,?,?)",
    )
    .run(
      id,
      offer,
      "ccda-to-fhir-mapping-decision-register",
      "download",
      `hash-${id}`,
      new Date().toISOString(),
    );
  const at = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT OR IGNORE INTO notice_version (id, version, notice_text, consent_text, created_by, created_at, approved_by, approved_at) VALUES ('nv-cov', 1, 'Notice text for coverage.', 'Consent text.', 'someone', ?, 'other', ?)",
    )
    .run(at, at);
  f.db.raw
    .prepare(
      "INSERT INTO consent_record (id, request_id, email_hash, notice_version_id, consent_given, recorded_at) VALUES (?,?,?,?,1,?)",
    )
    .run(`cr-${id}`, id, `hash-${id}`, "nv-cov", at);
  return id;
}
DRIVERS["POST /api/v1/offer-requests/:id/review"] = async (f) => ({
  url: `/api/v1/offer-requests/${makeRequest(f)}/review`,
  payload: { action: "mark_reviewed" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["POST /api/v1/notice-versions"] = async () => ({
  url: "/api/v1/notice-versions",
  payload: {
    noticeText: "A notice with enough words to be valid.",
    consentText: "I agree to be contacted.",
  },
});
DRIVERS["POST /api/v1/notice-versions/:id/approve"] = async (f) => {
  const id = `nv-${requestSeq++}`;
  f.db.raw
    .prepare(
      "INSERT INTO notice_version (id, version, notice_text, consent_text, created_by, created_at) VALUES (?, ?, 'Notice text for coverage.', 'Consent text.', 'someone', ?)",
    )
    .run(id, 1000 + requestSeq, new Date().toISOString());
  return { url: `/api/v1/notice-versions/${id}/approve`, payload: {} };
};

const EXEMPT: Record<string, string> = {
  // Reads and checks text, stores nothing and so writes no success audit event; a refusal is still audited.
  "POST /api/v1/claims/lint": "stores nothing",
  // The public form has no signed-in actor: each accepted submission writes one `offer_request.receive` audit
  // event (tests: public-download.int.test.ts), and a refusal is recorded by the PHI guard or not stored at all.
  "POST /api/v1/public/offers/:slug/requests":
    "public, unauthenticated; audited as offer_request.receive",
};

const REQUIRED = [
  "id",
  "occurred_at",
  "actor_type",
  "action",
  "entity_type",
  "outcome",
  "correlation_id",
  "row_hash",
];

function stateChangingRoutes(f: IdentityFixture): string[] {
  return f.routes
    .filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method))
    .map((r) => `${r.method} ${r.url}`);
}

describe("audit coverage of every state-changing route", () => {
  it("has a driver (or an explicit exemption) for every non-GET route", () => {
    const missing = stateChangingRoutes(fx).filter((r) => !(r in DRIVERS) && !(r in EXEMPT));
    expect(missing, `routes without audit coverage: ${missing.join(", ")}`).toEqual([]);
  });

  it("writes exactly one complete event per successful call, and one denied event per forbidden call", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
    const reader = await fx.makeUser("reader@example.org", ["read_only_executive"]);
    const method = (route: string) => route.split(" ")[0] as "POST" | "PUT" | "PATCH";

    for (const route of stateChangingRoutes(fx).filter((r) => r in DRIVERS)) {
      const call = await DRIVERS[route]!(fx);

      // forbidden
      const deniedBefore = count("outcome = 'denied'");
      const total = count("1=1");
      const forbidden = await fx.app.inject({
        method: method(route),
        url: call.url,
        headers: {
          authorization: `Bearer ${call.forbiddenRole ? reader.token : operator.token}`,
          "idempotency-key": `deny-${route.length}-aaaa`,
          ...(call.contentType ? { "content-type": call.contentType } : {}),
        },
        payload: call.payload ?? {},
      });
      expect(forbidden.statusCode, route).toBe(403);
      expect(count("outcome = 'denied'") - deniedBefore, route).toBe(1);
      expect(count("1=1") - total, route).toBe(1);

      // successful
      const before = count("outcome = 'success'");
      const ok = await fx.app.inject({
        method: method(route),
        url: call.url,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "idempotency-key": `ok-${route.length}-bbbbbb`,
          "x-correlation-id": "coverage-corr-01",
          ...(call.contentType ? { "content-type": call.contentType } : {}),
        },
        payload: call.payload ?? {},
      });
      expect([200, 201, 202, 204], route).toContain(ok.statusCode);
      expect(count("outcome = 'success'") - before, route).toBe(call.successEvents ?? 1);
      const written = fx.db.raw
        .prepare("SELECT * FROM audit_event WHERE outcome = 'success' ORDER BY rowid DESC LIMIT ?")
        .all(call.successEvents ?? 1) as Record<string, unknown>[];
      for (const event of written) {
        for (const field of REQUIRED) expect(event[field], `${route} ${field}`).toBeTruthy();
      }
      // The caller's own event names them; a queued-job event written by the system may have no actor.
      expect(
        written.some((e) => e["actor_id"] === admin.id),
        route,
      ).toBe(true);
    }
  });

  function count(where: string): number {
    return (
      fx.db.raw.prepare(`SELECT count(*) c FROM audit_event WHERE ${where}`).get() as { c: number }
    ).c;
  }
});
