import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T043 (quickstart V31): rate limiting, the allow-list of sites, body size and no cookies.
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture | undefined;
afterEach(async () => {
  await fx?.app.close();
});
const marketing = (id: string) => ({
  userId: id,
  actorType: "human" as const,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
  now: () => fx!.clock.now,
});
async function setup(options: { publicOrigins?: string[]; postLimitPerMinute?: number } = {}) {
  fx = await buildIdentityFixture(options);
  const draft = fx.engagement.notices.create(marketing("author-1"), {
    noticeText: "We use your details to send the register and, only if you agree, to contact you.",
    consentText: "I agree to be contacted about this topic.",
  });
  fx.engagement.notices.approve(marketing("approver-1"), draft.id);
  return fx;
}
const url = `/api/v1/public/offers/${SLUG}`;

describe("rate limiting", () => {
  it("throttles one address after the limit with a plain message and creates nothing beyond it", async () => {
    const f = await setup({ postLimitPerMinute: 5 });
    const form = (await f.app.inject({ method: "GET", url: `${url}/form` })).json();
    f.clock.now = new Date(f.clock.now.getTime() + 5000);
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) {
      const res = await f.app.inject({
        method: "POST",
        url: `${url}/requests`,
        payload: {
          kind: "download",
          formToken: form.formToken,
          noticeVersionId: form.notice.versionId,
          consentToContact: true,
          website: "",
          contact: {
            email: `person${i}@newco-${i}.example`,
            role: "Lead",
            orgName: `Newco ${i}`,
            orgType: "health_system",
          },
        },
      });
      statuses.push(res.statusCode);
      if (res.statusCode === 429) {
        expect(res.json().codes).toEqual(["rate_limited"]);
        expect(res.json().detail).toMatch(/wait a minute/i);
        expect(res.headers["retry-after"]).toBeDefined();
      }
    }
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(3);
    expect(
      (f.db.raw.prepare("SELECT count(*) c FROM offer_request").get() as { c: number }).c,
    ).toBe(5);
  });
});

describe("sites that may call the form", () => {
  it("refuses a browser call from a site that is not on the list, and with an empty list refuses every browser", async () => {
    const f = await setup();
    const res = await f.app.inject({
      method: "GET",
      url: `${url}/form`,
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().codes).toEqual(["origin_not_allowed"]);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const post = await f.app.inject({
      method: "POST",
      url: `${url}/requests`,
      headers: { origin: "https://evil.example" },
      payload: {},
    });
    expect(post.statusCode).toBe(403);
    // A server-side caller (the hosted pages) sends no Origin header and is allowed.
    expect((await f.app.inject({ method: "GET", url: `${url}/form` })).statusCode).toBe(200);
  });

  it("allows a listed site, answers its preflight and sets the allow header only for it", async () => {
    const f = await setup({ publicOrigins: ["https://www.example.org"] });
    const ok = await f.app.inject({
      method: "GET",
      url: `${url}/form`,
      headers: { origin: "https://www.example.org" },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["access-control-allow-origin"]).toBe("https://www.example.org");
    expect(ok.headers["access-control-allow-credentials"]).toBeUndefined();
    const preflight = await f.app.inject({
      method: "OPTIONS",
      url: `${url}/requests`,
      headers: {
        origin: "https://www.example.org",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });
    expect(preflight.statusCode).toBeLessThan(300);
    expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
    const other = await f.app.inject({
      method: "GET",
      url: `${url}/form`,
      headers: { origin: "https://other.example" },
    });
    expect(other.statusCode).toBe(403);
  });
});

describe("size, shape and cookies", () => {
  it("refuses an oversized body with 413 and a malformed one with 400, storing nothing", async () => {
    const f = await setup();
    const big = await f.app.inject({
      method: "POST",
      url: `${url}/requests`,
      payload: { kind: "download", padding: "x".repeat(70_000) },
    });
    expect(big.statusCode).toBe(413);
    const bad = await f.app.inject({
      method: "POST",
      url: `${url}/requests`,
      headers: { "content-type": "application/json" },
      payload: "{not json",
    });
    expect(bad.statusCode).toBe(400);
    expect(
      (await f.app.inject({ method: "POST", url: `${url}/requests`, payload: { kind: "other" } }))
        .statusCode,
    ).toBe(400);
    expect(
      (f.db.raw.prepare("SELECT count(*) c FROM offer_request").get() as { c: number }).c,
    ).toBe(0);
  });
  it("never sets a cookie or asks for a session", async () => {
    const f = await setup();
    for (const res of [
      await f.app.inject({ method: "GET", url: `${url}/form` }),
      await f.app.inject({ method: "GET", url: "/api/v1/public/downloads/nope" }),
      await f.app.inject({ method: "POST", url: `${url}/requests`, payload: {} }),
    ]) {
      expect(res.headers["set-cookie"]).toBeUndefined();
      expect(res.statusCode).not.toBe(401);
    }
  });
  it("rejects a form that does not take the requested kind", async () => {
    const f = await setup();
    const form = (
      await f.app.inject({
        method: "GET",
        url: `/api/v1/public/offers/sender-onboarding-friction-map/form`,
      })
    ).json();
    f.clock.now = new Date(f.clock.now.getTime() + 5000);
    const res = await f.app.inject({
      method: "POST",
      url: "/api/v1/public/offers/sender-onboarding-friction-map/requests",
      payload: {
        kind: "download",
        formToken: form.formToken,
        noticeVersionId: form.notice.versionId,
        website: "",
        contact: {
          email: "a@newco.example",
          role: "Lead",
          orgName: "Newco",
          orgType: "health_system",
        },
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().codes).toEqual(["kind_not_available"]);
  });
});
