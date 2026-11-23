import type { LightMyRequestResponse } from "fastify";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T044: real responses are validated against specs/006-offer-routing-lead-magnet/contracts/public.openapi.yaml.
const contract = new Contract("public.openapi.yaml", "006-offer-routing-lead-magnet");
const SLUG = "ccda-to-fhir-mapping-decision-register";
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);
const approve = () => {
  const who = (id: string) => ({
    userId: id,
    actorType: "human" as const,
    correlationId: null,
    permissions: FOUNDATION_ROLE_PERMISSIONS.campaign_approver,
    now: () => fx.clock.now,
  });
  const v = fx.engagement.notices.create(who("author"), {
    noticeText: "We use your details to send the register and, only if you agree, to contact you.",
    consentText: "I agree to be contacted about this topic.",
  });
  fx.engagement.notices.approve(who("approver"), v.id);
};
const body = (
  form: { formToken: string; notice: { versionId: string } },
  over: Record<string, unknown> = {},
) => ({
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
  ...over,
});

describe("GET /offers/{slug}/form", () => {
  it("503 before a notice is approved, 404 for another slug, 200 afterwards", async () => {
    const none = await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` });
    expect(none.statusCode).toBe(503);
    conforms("/offers/{slug}/form", "GET", none);
    approve();
    const ok = await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` });
    expect(ok.statusCode).toBe(200);
    conforms("/offers/{slug}/form", "GET", ok);
    const missing = await fx.app.inject({ method: "GET", url: "/api/v1/public/offers/nope/form" });
    expect(missing.statusCode).toBe(404);
    conforms("/offers/{slug}/form", "GET", missing);
  });
});

describe("POST /offers/{slug}/requests", () => {
  it("201 receipt, 400 for a refused form, 422 for patient-like text, 404 for an unknown slug", async () => {
    approve();
    const form = (
      await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
    ).json();
    const early = await fx.app.inject({
      method: "POST",
      url: `/api/v1/public/offers/${SLUG}/requests`,
      payload: body(form),
    });
    expect(early.statusCode).toBe(400);
    conforms("/offers/{slug}/requests", "POST", early);
    fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
    const phi = await fx.app.inject({
      method: "POST",
      url: `/api/v1/public/offers/${SLUG}/requests`,
      payload: body(form, {
        contact: {
          email: "dana@newco-hie.example",
          role: "SSN 123-45-6789",
          orgName: "Newco",
          orgType: "health_system",
        },
      }),
    });
    expect(phi.statusCode).toBe(422);
    conforms("/offers/{slug}/requests", "POST", phi);
    const ok = await fx.app.inject({
      method: "POST",
      url: `/api/v1/public/offers/${SLUG}/requests`,
      payload: body(form),
    });
    expect(ok.statusCode).toBe(201);
    conforms("/offers/{slug}/requests", "POST", ok);
    const personal = await fx.app.inject({
      method: "POST",
      url: `/api/v1/public/offers/${SLUG}/requests`,
      payload: body(form, {
        contact: {
          email: "pat@gmail.com",
          role: "Lead",
          orgName: "Newco",
          orgType: "health_system",
        },
      }),
    });
    expect(personal.statusCode).toBe(201);
    conforms("/offers/{slug}/requests", "POST", personal);
    expect(personal.json().flags).toEqual(["personal_email"]);
    const unknown = await fx.app.inject({
      method: "POST",
      url: "/api/v1/public/offers/nope/requests",
      payload: {},
    });
    expect(unknown.statusCode).toBe(404);
    conforms("/offers/{slug}/requests", "POST", unknown);
  });
});

describe("GET /downloads/{token}", () => {
  it("200 file, 410 expired, 404 unknown", async () => {
    approve();
    const form = (
      await fx.app.inject({ method: "GET", url: `/api/v1/public/offers/${SLUG}/form` })
    ).json();
    fx.clock.now = new Date(fx.clock.now.getTime() + 5000);
    const url = (
      await fx.app.inject({
        method: "POST",
        url: `/api/v1/public/offers/${SLUG}/requests`,
        payload: body(form),
      })
    ).json().download.url as string;
    const ok = await fx.app.inject({ method: "GET", url });
    expect(ok.statusCode).toBe(200);
    expect(ok.headers["content-type"]).toContain("application/pdf");
    fx.clock.now = new Date(fx.clock.now.getTime() + 25 * 3_600_000);
    const gone = await fx.app.inject({ method: "GET", url });
    expect(gone.statusCode).toBe(410);
    conforms("/downloads/{token}", "GET", gone);
    const missing = await fx.app.inject({ method: "GET", url: "/api/v1/public/downloads/nope" });
    expect(missing.statusCode).toBe(404);
    conforms("/downloads/{token}", "GET", missing);
  });
});
