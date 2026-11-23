import { FOUNDATION_ROLE_PERMISSIONS, RULE_SET_V1 } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T072 (quickstart V33, V34): every create, change, acceptance, dismissal, consent, notice approval, rule
// set activation and PHI refusal is audited with identifiers only, and no personal or free text reaches an
// audit row, an event or a refusal record.
const SLUG = "ccda-to-fhir-mapping-decision-register";
const PERSONAL = {
  email: "alex.distinctive@northvale-hie.example",
  name: "Alexandra Distinctivename",
  role: "Distinctive Role Title",
  org: "Northvale Distinctive Exchange",
  decision: "Which distinctive segment carries the results?",
  reason: "A distinctive dismissal reason",
  waitReason: "A distinctive wait-list reason",
  noticeWords: "distinctive privacy wording here for the notice",
};
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});
const person = (id: string, role: keyof typeof FOUNDATION_ROLE_PERMISSIONS) => ({
  userId: id,
  actorType: "human" as const,
  correlationId: "corr-audit",
  permissions: FOUNDATION_ROLE_PERMISSIONS[role],
  now: () => fx.clock.now,
});
const advance = (ms: number) => {
  fx.clock.now = new Date(fx.clock.now.getTime() + ms);
};
async function submit(payload: Record<string, unknown>) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  advance(5000);
  return fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      website: "",
      consentToContact: true,
      ...payload,
    },
  });
}
const actions = () =>
  (
    fx.db.raw.prepare("SELECT action, outcome FROM audit_event ORDER BY rowid").all() as {
      action: string;
      outcome: string;
    }[]
  ).map((a) => `${a.action}:${a.outcome}`);
const only = (action: string) => actions().filter((a) => a.startsWith(`${action}:`));

describe("auditing across the public and operator flows", () => {
  it("records one event for each change, with who and when, and none carries personal or free text", async () => {
    // A notice is drafted and approved by two different people.
    const notice = fx.engagement.notices.create(person("author", "campaign_approver"), {
      noticeText: `We use ${PERSONAL.noticeWords} to send the register.`,
      consentText: "I agree to be contacted about this.",
    });
    fx.engagement.notices.approve(person("approver", "campaign_approver"), notice.id);

    // A visitor downloads, asks for a session and a personal-email visitor downloads.
    const at = fx.clock.now.toISOString();
    fx.db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a-n','Northvale','northvale',?,?)",
      )
      .run(at, at);
    fx.db.raw
      .prepare(
        "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES ('c-n','a-n','health_information_exchange',?)",
      )
      .run(at);
    fx.db.raw
      .prepare(
        "INSERT INTO account_domain (id, account_id, domain, created_at) VALUES ('d-n','a-n','northvale-hie.example',?)",
      )
      .run(at);
    fx.db.raw
      .prepare(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES ('e-n','a-n','sender_onboarding_friction','x','ref',?,?,'observed')",
      )
      .run(at, at);
    const contact = {
      email: PERSONAL.email,
      displayName: PERSONAL.name,
      role: PERSONAL.role,
      orgName: PERSONAL.org,
      orgType: "health_information_exchange",
    };
    const first = await submit({ kind: "download", contact });
    expect(first.statusCode).toBe(201);
    advance(120_000);
    expect(
      (await submit({ kind: "working_session", contact, decisions: [PERSONAL.decision] }))
        .statusCode,
    ).toBe(201);
    advance(120_000);
    expect(
      (
        await submit({
          kind: "download",
          contact: { ...contact, email: "pat.distinctive@gmail.com" },
        })
      ).statusCode,
    ).toBe(201);

    // An operator accepts one recommendation, dismisses another, reviews a request, wait-lists, and a lead activates rules.
    const operator = person("operator-1", "gtm_operator");
    const rec = fx.db.raw.prepare("SELECT id FROM offer_recommendation").get() as { id: string };
    fx.routing.recommendations.accept(operator, rec.id);
    const second = await fx.routing.recommendations.recommend(operator, { accountId: "a-n" });
    fx.routing.recommendations.dismiss(operator, second.id, { reason: PERSONAL.reason });
    const request = fx.db.raw
      .prepare("SELECT id FROM offer_request WHERE kind = 'working_session'")
      .get() as { id: string };
    fx.engagement.requests.review(operator, request.id, { action: "mark_reviewed" });
    const entry = fx.routing.waitlist.add(operator, "offer-6", {
      accountId: "a-n",
      reason: PERSONAL.waitReason,
    });
    fx.routing.waitlist.close(operator, "offer-6", entry.id, {
      state: "removed",
      reason: PERSONAL.waitReason,
    });
    const lead = person("lead-1", "sales_service_lead");
    const draft = fx.routing.ruleSets.createDraft(lead, {
      rules: RULE_SET_V1,
      reason: "A distinctive rules reason",
    });
    fx.routing.ruleSets.activate(lead, draft.version, {
      reason: "A distinctive activation reason",
    });
    fx.routing.suppression.add(operator, {
      scope: "account",
      accountId: "a-n",
      reason: "A distinctive suppression reason",
    });

    // PHI refusal on the public form.
    advance(120_000);
    expect(
      (await submit({ kind: "download", contact: { ...contact, role: "SSN 123-45-6789" } }))
        .statusCode,
    ).toBe(422);

    // One audit event for each change.
    for (const [action, n] of [
      ["notice.create", 1],
      ["notice.approve", 1],
      ["offer_request.receive", 3],
      ["offer.recommend", 2],
      ["offer.recommendation.accept", 1],
      ["offer.recommendation.dismiss", 1],
      ["offer_request.review", 1],
      ["offer.waitlist.add", 1],
      ["offer.waitlist.close", 1],
      ["routing.rules.create", 1],
      ["routing.rules.activate", 1],
      ["suppression.add", 1],
      ["phi.blocked", 1],
    ] as const) {
      expect(only(action), action).toHaveLength(n);
    }
    // The consent for each submission is recorded in its own append-only table, with the notice version.
    expect(
      (fx.db.raw.prepare("SELECT count(*) c FROM consent_record").get() as { c: number }).c,
    ).toBe(3);
    // The PHI refusal also raised the operator alert, with rule identifiers only.
    expect(
      (
        fx.db.raw
          .prepare("SELECT count(*) c FROM outbox_event WHERE type = 'operator.alert.phi'")
          .get() as { c: number }
      ).c,
    ).toBe(1);

    // Who and when are always present.
    const rows = fx.db.raw
      .prepare("SELECT actor_type, occurred_at, correlation_id, entity_type FROM audit_event")
      .all() as Record<string, string>[];
    for (const r of rows) {
      expect(r["actor_type"]).toBeTruthy();
      expect(r["occurred_at"]).toBeTruthy();
      expect(r["entity_type"]).toBeTruthy();
    }

    // No personal or free text anywhere an audit row, an event, a guard decision or a refusal record.
    const everything = JSON.stringify([
      fx.db.raw.prepare("SELECT before_summary, after_summary, entity_id FROM audit_event").all(),
      fx.db.raw.prepare("SELECT payload FROM outbox_event").all(),
      fx.db.raw.prepare("SELECT * FROM phi_guard_decision").all(),
      fx.db.raw.prepare("SELECT * FROM ai_invocation").all(),
    ]);
    for (const [name, value] of Object.entries(PERSONAL)) {
      expect(everything, name).not.toContain(value);
    }
    expect(everything).not.toMatch(/pat\.distinctive|123-45-6789|distinctive/i);
  });

  it("audits every refusal in its own event, with codes only", async () => {
    const operator = person("operator-1", "gtm_operator");
    const analyst = person("analyst-1", "research_analyst");
    const calls: (() => unknown)[] = [
      () =>
        fx.engagement.notices.create(operator, {
          noticeText: "A notice with distinctive words in it.",
          consentText: "I agree to be contacted.",
        }),
      () => fx.engagement.requests.review(analyst, "nope", { action: "mark_reviewed" }),
      () =>
        fx.routing.waitlist.add(analyst, "offer-6", {
          accountId: "nope",
          reason: "A distinctive reason",
        }),
      () =>
        fx.routing.ruleSets.createDraft(operator, {
          rules: RULE_SET_V1,
          reason: "A distinctive reason",
        }),
    ];
    for (const call of calls) expect(call).toThrow();
    await expect(
      fx.routing.recommendations.recommend(analyst, { accountId: "nope" }),
    ).rejects.toBeTruthy();
    const denied = fx.db.raw
      .prepare("SELECT action, after_summary FROM audit_event WHERE outcome = 'denied'")
      .all() as { action: string; after_summary: string }[];
    expect(denied.map((d) => d.action).sort()).toEqual([
      "notice.create.refused",
      "offer.recommend.refused",
      "offer.waitlist.add.refused",
      "offer_request.review.refused",
      "routing.rules.create.refused",
    ]);
    expect(JSON.stringify(denied)).not.toMatch(/distinctive/);
    for (const d of denied) expect(JSON.parse(d.after_summary).codes).toContain("forbidden");
  });
});
