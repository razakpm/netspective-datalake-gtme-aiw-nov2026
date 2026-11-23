import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T070 (quickstart V34, V35): Scenarios C and G end to end over the synthetic organisations, through the
// real routes: organisations imported by CSV, evidence recorded, the register downloaded on the public form.
const FIXTURES = join(import.meta.dirname, "../../../tests/fixtures/synthetic-orgs");
const SLUG = "ccda-to-fhir-mapping-decision-register";
const O1 = "sender-onboarding-friction-map";
const O6 = "pilot-input-trace-workshop";
let fx: IdentityFixture;
let operator: { token: string };
let n = 0;

beforeEach(async () => {
  fx = await buildIdentityFixture();
  operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
  const res = await fx.app.inject({
    method: "POST",
    url: "/api/v1/accounts/import",
    headers: {
      authorization: `Bearer ${operator.token}`,
      "content-type": "text/csv",
      "idempotency-key": `scenario-import-${++n}-pad`,
    },
    payload: readFileSync(join(FIXTURES, "organisations.csv"), "utf8"),
  });
  expect(res.statusCode).toBeLessThan(300);
  const evidence = JSON.parse(readFileSync(join(FIXTURES, "evidence.json"), "utf8")) as {
    account: string;
    topic: string;
    status: string;
    what: string;
    whereRef: string;
    observedAt: string;
  }[];
  for (const e of evidence) {
    const account = fx.db.raw
      .prepare("SELECT account_id id FROM account_domain WHERE domain = ?")
      .get(e.account) as { id: string };
    fx.db.raw
      .prepare(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        `ev-${++n}`,
        account.id,
        e.topic,
        e.what,
        e.whereRef,
        e.observedAt,
        e.observedAt,
        e.status,
      );
  }
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const v = fx.engagement.notices.create(who("author"), {
    noticeText:
      "We use your details to send the register and, only if you agree, to contact you about it.",
    consentText: "I agree to be contacted about this topic.",
  });
  fx.engagement.notices.approve(who("approver"), v.id);
});
afterEach(async () => {
  await fx.app.close();
});

const advance = (ms: number) => {
  fx.clock.now = new Date(fx.clock.now.getTime() + ms);
};
async function download(email: string, orgName: string, orgType: string, consent = true) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  advance(5000);
  return fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      kind: "download",
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: consent,
      website: "",
      contact: { email, role: "Lead", orgName, orgType },
    },
  });
}
const followUp = (domain: string) =>
  fx.db.raw
    .prepare(
      `SELECT r.outcome, r.outreach, r.review_state, r.trigger, o.key offer_key FROM offer_recommendation r
       LEFT JOIN engagement_offer o ON o.id = r.offer_id JOIN account_domain d ON d.account_id = r.account_id WHERE d.domain = ?`,
    )
    .get(domain) as
    | {
        outcome: string;
        outreach: string;
        review_state: string;
        trigger: string;
        offer_key: string | null;
      }
    | undefined;
const count = (table: string, where = "1=1") =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;

describe("Scenario C: the Offer 5 lead magnet", () => {
  it("northvale-hie (ICP 1): account, contact, fit, first-party engagement and an Offer 1 follow-up waiting for a person", async () => {
    const res = await download(
      "alex.interop@northvale-hie.example",
      "Northvale Health Information Exchange",
      "health_information_exchange",
    );
    expect(res.statusCode).toBe(201);
    expect(res.json().download.delivered).toBe(true);
    expect(count("account")).toBe(8);
    expect(count("lead_magnet_download")).toBe(1);
    expect(followUp("northvale-hie.example")).toMatchObject({
      outcome: "offer",
      outreach: "allowed",
      review_state: "pending",
      trigger: "offer5_download",
      offer_key: O1,
    });
    expect(count("offer_request", "kind = 'download' AND state = 'received'")).toBe(1);
  });

  it("riverbend-health (ICP 2): an Offer 6 follow-up", async () => {
    await download("casey.datalead@riverbend-health.example", "Riverbend Health", "health_system");
    expect(followUp("riverbend-health.example")).toMatchObject({
      outcome: "offer",
      offer_key: O6,
      review_state: "pending",
    });
  });

  it("helixbio (excluded): delivered and recorded, no outreach", async () => {
    const res = await download("lee@helixbio.example", "Helixbio Therapeutics", "biotech");
    expect(res.json().download.delivered).toBe(true);
    expect(followUp("helixbio.example")).toMatchObject({
      outcome: "no_action",
      outreach: "blocked",
    });
  });

  it("the unsubscribed contact: delivered and recorded, never a follow-up (V25)", async () => {
    const first = await download(
      "pat.unsubscribed@northvale-hie.example",
      "Northvale Health Information Exchange",
      "health_information_exchange",
    );
    expect(first.statusCode).toBe(201);
    const contact = fx.db.raw
      .prepare(
        "SELECT id FROM contact WHERE business_email = 'pat.unsubscribed@northvale-hie.example'",
      )
      .get() as { id: string };
    fx.routing.suppression.add(
      { userId: "op", actorType: "human", correlationId: null, permissions: [] },
      { scope: "contact", contactId: contact.id, reason: "Unsubscribed" },
    );
    const before = count("offer_recommendation");
    advance(120_000);
    const again = await download(
      "pat.unsubscribed@northvale-hie.example",
      "Northvale Health Information Exchange",
      "health_information_exchange",
    );
    expect(again.json().download.delivered).toBe(true);
    expect(count("offer_recommendation")).toBe(before);
  });

  it("a person who declined to be contacted still gets the register, and the recommendation says outreach is blocked", async () => {
    await download(
      "alex.interop@northvale-hie.example",
      "Northvale Health Information Exchange",
      "health_information_exchange",
      false,
    );
    expect(followUp("northvale-hie.example")).toMatchObject({
      outcome: "no_action",
      outreach: "blocked",
    });
  });

  it("sends nothing and records only identifiers in events and audit (V34)", async () => {
    await download(
      "alex.interop@northvale-hie.example",
      "Northvale Health Information Exchange",
      "health_information_exchange",
    );
    const events = fx.db.raw
      .prepare(
        "SELECT type, payload FROM outbox_event WHERE type IN ('offer.requested','lead_magnet.downloaded','offer.recommended')",
      )
      .all() as { type: string; payload: string }[];
    expect(events.map((e) => e.type).sort()).toEqual([
      "lead_magnet.downloaded",
      "offer.recommended",
      "offer.requested",
    ]);
    const text = JSON.stringify([
      events,
      fx.db.raw.prepare("SELECT before_summary, after_summary FROM audit_event").all(),
    ]);
    expect(text).not.toMatch(/alex\.interop|Northvale Health|explanation|https?:/i);
    expect(fx.fakeLlm.calls).toHaveLength(0);
  });
});

describe("Scenario G: capacity", () => {
  it("a full Offer 6 is not recommended for riverbend-health; alternatives and the wait-list are offered; a freed place restores it", async () => {
    const lead = (id: string, role: keyof typeof FOUNDATION_ROLE_PERMISSIONS) => ({
      userId: id,
      actorType: "human" as const,
      correlationId: null,
      permissions: FOUNDATION_ROLE_PERMISSIONS[role],
      now: () => fx.clock.now,
    });
    const account = (
      fx.db.raw
        .prepare(
          "SELECT account_id id FROM account_domain WHERE domain = 'riverbend-health.example'",
        )
        .get() as { id: string }
    ).id;
    fx.db.raw
      .prepare(
        "INSERT INTO account_hypothesis (id, account_id, origin, acceptance, statement, category, status, confidence_band, confidence_explanation, created_by, created_at, updated_at, accepted_by, accepted_at) VALUES ('h-river', ?, 'analyst','accepted','The pilot stalled on input provenance.','pilot_input_quality','strengthening','medium','Buyer confirmed it.','analyst-1',?,?,'analyst-1',?)",
      )
      .run(
        account,
        fx.clock.now.toISOString(),
        fx.clock.now.toISOString(),
        fx.clock.now.toISOString(),
      );
    fx.db.transaction((tx) =>
      fx.routing.icp.assess(tx, account, {
        actorId: "op",
        actorType: "human",
        correlationId: null,
      }),
    );
    const bookings = [1, 2, 3].map((i) =>
      fx.catalogue.bookings.record(lead("lead-1", "sales_service_lead"), "offer-6", {
        sessionDate: fx.clock.now.toISOString().slice(0, 10),
        externalRef: `g-${i}`,
      }),
    );
    const op = lead("operator-1", "gtm_operator");

    const full = await fx.routing.recommendations.recommend(op, { accountId: account });
    expect(full).toMatchObject({ outcome: "research", offerKey: null });
    expect(full.excluded).toContainEqual({ offerKey: O6, code: "capacity_exhausted" });
    expect(full.alternatives.map((a) => a.kind)).toEqual([
      "wait_list",
      "offer",
      "research",
      "do_nothing",
    ]);

    fx.routing.waitlist.add(op, "offer-6", {
      accountId: account,
      reason: "Offer 6 is full this month",
    });
    expect(fx.routing.waitlist.list(op, "offer-6")).toHaveLength(1);

    fx.catalogue.bookings.cancel(lead("lead-1", "sales_service_lead"), bookings[0]!.id);
    fx.routing.recommendations.dismiss(op, full.id, { reason: "A place opened" });
    expect(await fx.routing.recommendations.recommend(op, { accountId: account })).toMatchObject({
      outcome: "offer",
      offerKey: O6,
    });
  });
});

describe("response times (plan: performance goals)", () => {
  it("a recommendation takes under 500 ms, a form fetch and a submission each under 1 s, a link under 300 ms", async () => {
    const t = async <T>(fn: () => Promise<T>) => {
      const start = performance.now();
      const result = await fn();
      return { ms: performance.now() - start, result };
    };
    const form = await t(() =>
      fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` }),
    );
    expect(form.ms).toBeLessThan(1000);
    advance(5000);
    const f = form.result.json();
    const post = await t(() =>
      fx.app.inject({
        method: "POST",
        url: `/api/v1/public/offers/${SLUG}/requests`,
        payload: {
          kind: "download",
          formToken: f.formToken,
          noticeVersionId: f.notice.versionId,
          consentToContact: true,
          website: "",
          contact: {
            email: "alex.interop@northvale-hie.example",
            role: "Lead",
            orgName: "Northvale Health Information Exchange",
            orgType: "health_information_exchange",
          },
        },
      }),
    );
    expect(post.ms).toBeLessThan(1000);
    const link = await t(() =>
      fx.app.inject({ method: "GET", url: post.result.json().download.url }),
    );
    expect(link.ms).toBeLessThan(300);
    const account = (
      fx.db.raw
        .prepare("SELECT account_id id FROM account_domain WHERE domain = 'northvale-hie.example'")
        .get() as { id: string }
    ).id;
    const rec = await t(() =>
      fx.routing.recommendations.recommend(
        {
          userId: "op",
          actorType: "human",
          correlationId: null,
          permissions: FOUNDATION_ROLE_PERMISSIONS.gtm_operator,
          now: () => fx.clock.now,
        },
        { accountId: account },
      ),
    );
    expect(rec.ms).toBeLessThan(500);
  });
});
