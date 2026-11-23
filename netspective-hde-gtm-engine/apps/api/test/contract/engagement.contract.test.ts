import type { LightMyRequestResponse } from "fastify";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T044: real responses are validated against specs/006-offer-routing-lead-magnet/contracts/engagement.openapi.yaml.
const contract = new Contract("engagement.openapi.yaml", "006-offer-routing-lead-magnet");
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture;
let t: { operator: string; marketing: string };
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  t = {
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    marketing: (await fx.makeUser("marketing@example.org", ["campaign_approver"])).token,
  };
});
afterEach(async () => {
  await fx.app.close();
});
const call = (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `eng-key-${++n}-padding-xx` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);

describe("notice versions", () => {
  it("POST, GET and POST approve", async () => {
    const draft = await call(t.marketing, "POST", "/notice-versions", {
      noticeText: "We use your details to send the register and nothing else.",
      consentText: "I agree to be contacted.",
    });
    expect(draft.statusCode).toBe(201);
    conforms("/notice-versions", "POST", draft);
    const bad = await call(t.marketing, "POST", "/notice-versions", {
      noticeText: "short",
      consentText: "short",
    });
    expect(bad.statusCode).toBe(400);
    conforms("/notice-versions", "POST", bad);
    const list = await call(t.marketing, "GET", "/notice-versions");
    expect(list.statusCode).toBe(200);
    conforms("/notice-versions", "GET", list);
    const denied = await call(t.operator, "POST", "/notice-versions", {
      noticeText: "We use your details to send the register and nothing else.",
      consentText: "I agree to be contacted.",
    });
    expect(denied.statusCode).toBe(403);
    conforms("/notice-versions", "POST", denied);
    const id = draft.json().id as string;
    const own = await call(t.marketing, "POST", `/notice-versions/${id}/approve`, {});
    expect(own.statusCode).toBe(409);
    conforms("/notice-versions/{id}/approve", "POST", own);
    const other = await fx.makeUser("approver2@example.org", ["campaign_approver"]);
    const ok = await call(other.token, "POST", `/notice-versions/${id}/approve`, {});
    expect(ok.statusCode).toBe(200);
    conforms("/notice-versions/{id}/approve", "POST", ok);
    const missing = await call(other.token, "POST", "/notice-versions/nope/approve", {});
    expect(missing.statusCode).toBe(404);
    conforms("/notice-versions/{id}/approve", "POST", missing);
  });
});

describe("requests", () => {
  it("GET list, GET one and POST review", async () => {
    const who = (id: string) => ({
      userId: id,
      actorType: "human" as const,
      correlationId: null,
      permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
      now: () => fx.clock.now,
    });
    const v = fx.engagement.notices.create(who("author"), {
      noticeText: "We use your details to send the register and nothing else.",
      consentText: "I agree to be contacted.",
    });
    fx.engagement.notices.approve(who("approver"), v.id);
    const form = (
      await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
    ).json();
    fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
    const id = (
      await fx.app.inject({
        method: "POST",
        url: `/api/v1/public/offers/${SLUG}/requests`,
        payload: {
          kind: "download",
          formToken: form.formToken,
          noticeVersionId: form.notice.versionId,
          consentToContact: true,
          website: "",
          contact: {
            email: "dana@newco-hie.example",
            role: "Lead",
            orgName: "Newco HIE",
            orgType: "health_information_exchange",
          },
        },
      })
    ).json().requestId as string;
    const list = await call(t.operator, "GET", "/offer-requests");
    expect(list.statusCode).toBe(200);
    conforms("/offer-requests", "GET", list);
    const one = await call(t.operator, "GET", `/offer-requests/${id}`);
    expect(one.statusCode).toBe(200);
    conforms("/offer-requests/{id}", "GET", one);
    const missing = await call(t.operator, "GET", "/offer-requests/nope");
    expect(missing.statusCode).toBe(404);
    conforms("/offer-requests/{id}", "GET", missing);
    const review = await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "mark_reviewed",
    });
    expect(review.statusCode).toBe(200);
    conforms("/offer-requests/{id}/review", "POST", review);
    const bad = await call(t.operator, "POST", `/offer-requests/${id}/review`, { action: "close" });
    expect(bad.statusCode).toBe(400);
    conforms("/offer-requests/{id}/review", "POST", bad);
    const denied = await call(t.marketing, "POST", `/offer-requests/${id}/review`, {
      action: "close",
      reason: "Duplicate request",
    });
    expect(denied.statusCode).toBe(403);
    conforms("/offer-requests/{id}/review", "POST", denied);
    await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "close",
      reason: "Duplicate request",
    });
    const closed = await call(t.operator, "POST", `/offer-requests/${id}/review`, {
      action: "mark_reviewed",
    });
    expect(closed.statusCode).toBe(409);
    conforms("/offer-requests/{id}/review", "POST", closed);
  });
});
