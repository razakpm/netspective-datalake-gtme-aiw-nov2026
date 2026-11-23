import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T051 (quickstart V32, V33): the request inbox over HTTP, with its permissions.
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture;
let t: Record<"operator" | "analyst" | "reader" | "marketing" | "lead", string>;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  t = {
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    analyst: (await fx.makeUser("analyst@example.org", ["research_analyst"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
    marketing: (await fx.makeUser("marketing@example.org", ["campaign_approver"])).token,
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
  };
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const v = fx.engagement.notices.create(who("author-1"), {
    noticeText: "We use your details to send the register and, only if you agree, to contact you.",
    consentText: "I agree to be contacted about this topic.",
  });
  fx.engagement.notices.approve(who("approver-1"), v.id);
});
afterEach(async () => {
  await fx.app.close();
});
const call = (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `inbox-key-${++n}-padding-x` },
    payload: payload as object | undefined,
  });
async function submit(email: string, over: Record<string, unknown> = {}) {
  const form = (
    await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
  ).json();
  fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
  const res = await fx.app.inject({
    method: "POST",
    url: `/api/v1/public/offers/${SLUG}/requests`,
    payload: {
      kind: "download",
      formToken: form.formToken,
      noticeVersionId: form.notice.versionId,
      consentToContact: true,
      website: "",
      contact: {
        email,
        role: "Integration Lead",
        orgName: "Newco HIE",
        orgType: "health_information_exchange",
      },
      ...over,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json().requestId as string;
}

describe("the inbox", () => {
  it("lists and filters requests with their flags and review state, newest first (V32)", async () => {
    const a = await submit("dana@newco-hie.example");
    fx.clock.now = new Date(fx.clock.now.getTime() + 120_000);
    const b = await submit("pat@gmail.com");
    const all = (await call(t.operator, "GET", "/offer-requests")).json().items;
    expect(all.map((r: { id: string }) => r.id)).toEqual([b, a]);
    expect(all[0]).toMatchObject({
      kind: "download",
      state: "received",
      flags: expect.arrayContaining(["personal_email"]),
      accountId: null,
    });
    expect(
      (await call(t.operator, "GET", "/offer-requests?flag=personal_email")).json().items,
    ).toHaveLength(1);
    expect(
      (await call(t.operator, "GET", "/offer-requests?kind=intake")).json().items,
    ).toHaveLength(0);
    expect(
      (await call(t.operator, "GET", "/offer-requests?state=closed")).json().items,
    ).toHaveLength(0);
    expect((await call(t.operator, "GET", "/offer-requests?state=nope")).statusCode).toBe(400);
  });

  it("shows one request with its consent record, download and the recommendation made from it", async () => {
    const id = await submit("dana@newco-hie.example");
    const detail = (await call(t.operator, "GET", `/offer-requests/${id}`)).json();
    expect(detail).toMatchObject({
      id,
      roleTitle: "Integration Lead",
      consent: { consentGiven: true },
      download: { delivered: true },
      decisions: null,
      intake: null,
    });
    expect(detail.recommendationId).toEqual(expect.any(String));
    expect((await call(t.operator, "GET", "/offer-requests/nope")).statusCode).toBe(404);
  });

  it("moves received to reviewed, and closing needs a reason; a closed request cannot change", async () => {
    const id = await submit("dana@newco-hie.example");
    const reviewed = await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "mark_reviewed",
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().state).toBe("reviewed");
    expect(
      (await call(t.operator, "POST", `/offer-requests/${id}/review`, { action: "close" }))
        .statusCode,
    ).toBe(400);
    const closed = await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "close",
      reason: "Duplicate of another request",
    });
    expect(closed.json().state).toBe("closed");
    const again = await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "mark_reviewed",
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().codes).toContain("request_closed");
  });

  it("links a request to an account and contact, and a personal-email request only with a business email (V32)", async () => {
    const personal = await submit("pat@gmail.com");
    const acc = await submit("dana@newco-hie.example");
    const account = fx.db.raw
      .prepare("SELECT account_id a FROM offer_request WHERE id = ?")
      .get(acc) as { a: string };
    const noEmail = await call(t.operator, "POST", `/offer-requests/${personal}/review`, {
      action: "link",
      accountId: account.a,
    });
    expect(noEmail.statusCode).toBe(400);
    expect(noEmail.json().codes).toContain("business_email_required");
    const personalAgain = await call(t.operator, "POST", `/offer-requests/${personal}/review`, {
      action: "link",
      accountId: account.a,
      businessEmail: "pat@yahoo.com",
    });
    expect(personalAgain.statusCode).toBe(400);
    expect(personalAgain.json().codes).toContain("personal_email_not_business");
    expect((fx.db.raw.prepare("SELECT count(*) c FROM contact").get() as { c: number }).c).toBe(1);
    const linked = await call(t.operator, "POST", `/offer-requests/${personal}/review`, {
      action: "link",
      accountId: account.a,
      businessEmail: "pat@newco-hie.example",
    });
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toMatchObject({ state: "linked", accountId: account.a });
    expect((fx.db.raw.prepare("SELECT count(*) c FROM contact").get() as { c: number }).c).toBe(2);
    expect(
      fx.db.raw
        .prepare(
          "SELECT consent_given FROM consent_record WHERE request_id = ? AND contact_id IS NOT NULL",
        )
        .get(personal),
    ).toEqual({ consent_given: 1 });
    expect(
      (
        await call(t.operator, "POST", `/offer-requests/${acc}/review`, {
          action: "link",
          accountId: "nope",
        })
      ).statusCode,
    ).toBe(404);
  });
});

describe("permissions (V33)", () => {
  it("lets requests.read roles list and open, and only requests.review roles act", async () => {
    const id = await submit("dana@newco-hie.example");
    for (const who of ["operator", "analyst", "lead"] as const)
      expect((await call(t[who], "GET", "/offer-requests")).statusCode, who).toBe(200);
    for (const who of ["reader", "marketing"] as const)
      expect((await call(t[who], "GET", "/offer-requests")).statusCode, who).toBe(403);
    for (const who of ["analyst", "reader", "marketing"] as const) {
      expect(
        (await call(t[who], "POST", `/offer-requests/${id}/review`, { action: "mark_reviewed" }))
          .statusCode,
        who,
      ).toBe(403);
    }
    expect(
      (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c,
    ).toBeGreaterThanOrEqual(5);
    expect(
      (
        fx.db.raw.prepare("SELECT state FROM offer_request WHERE id = ?").get(id) as {
          state: string;
        }
      ).state,
    ).toBe("received");
  });

  it("lets only notices.manage and notices.approve roles handle notice versions, and the author cannot approve", async () => {
    const draft = await call(t.marketing, "POST", "/notice-versions", {
      noticeText: "A new notice with enough words to be valid.",
      consentText: "I agree to be contacted.",
    });
    expect(draft.statusCode).toBe(201);
    const id = draft.json().id as string;
    for (const who of ["operator", "analyst", "reader", "lead"] as const) {
      expect(
        (
          await call(t[who], "POST", "/notice-versions", {
            noticeText: "A new notice with enough words to be valid.",
            consentText: "I agree to be contacted.",
          })
        ).statusCode,
        who,
      ).toBe(403);
      expect(
        (await call(t[who], "POST", `/notice-versions/${id}/approve`, {})).statusCode,
        who,
      ).toBe(403);
    }
    const self = await call(t.marketing, "POST", `/notice-versions/${id}/approve`, {});
    expect(self.statusCode).toBe(409);
    expect(self.json().codes).toContain("author_cannot_approve");
    expect(
      (await call(t.marketing, "GET", "/notice-versions")).json().items.length,
    ).toBeGreaterThanOrEqual(2);
    expect((await call(t.operator, "GET", "/notice-versions")).statusCode).toBe(403);
    expect((await fx.app.inject({ method: "GET", url: "/api/v1/offer-requests" })).statusCode).toBe(
      401,
    );
  });
});
