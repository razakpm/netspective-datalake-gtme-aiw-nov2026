import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RULE_SET_V1 } from "@gtm/domain";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T038 (quickstart V33): each route as a role without the permission gives 403 and an audited refusal.
let fx: IdentityFixture;
let tokens: Record<"analyst" | "operator" | "reader" | "marketing" | "lead", string>;
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  tokens = {
    analyst: (await fx.makeUser("analyst@example.org", ["research_analyst"])).token,
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
    marketing: (await fx.makeUser("marketing@example.org", ["campaign_approver"])).token,
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
  };
  const at = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
    )
    .run(at, at);
});
afterEach(async () => {
  await fx.app.close();
});
const call = (token: string, method: "GET" | "POST", url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `rbac-key-${++n}-padding-x` },
    payload: payload as object | undefined,
  });
const denied = () =>
  (
    fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
      c: number;
    }
  ).c;

describe("routing permissions over HTTP", () => {
  it("lets only offers.recommend roles request, accept or dismiss, and audits each refusal", async () => {
    const before = denied();
    for (const who of ["analyst", "reader", "marketing"] as const) {
      const res = await call(tokens[who], "POST", "/accounts/a1/offer-recommendations", {});
      expect(res.statusCode, who).toBe(403);
    }
    expect(denied() - before).toBe(3);
    const made = await call(tokens.operator, "POST", "/accounts/a1/offer-recommendations", {});
    expect(made.statusCode).toBe(201);
    const id = (made.json() as { id: string }).id;
    expect(
      (
        await call(tokens.reader, "POST", `/offer-recommendations/${id}/review`, {
          decision: "accept",
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(tokens.analyst, "POST", `/offer-recommendations/${id}/review`, {
          decision: "dismiss",
          reason: "No" + "pe",
        })
      ).statusCode,
    ).toBe(403);
  });

  it("lets anyone with offers.read see recommendations and the review queue", async () => {
    await call(tokens.operator, "POST", "/accounts/a1/offer-recommendations", {});
    for (const who of ["reader", "analyst", "operator"] as const) {
      expect(
        (await call(tokens[who], "GET", "/accounts/a1/offer-recommendations")).statusCode,
        who,
      ).toBe(200);
      expect((await call(tokens[who], "GET", "/offer-recommendations")).statusCode, who).toBe(200);
    }
    expect((await call(tokens.marketing, "GET", "/offer-recommendations")).statusCode).toBe(403);
  });

  it("lets only routing.rules.manage create and activate rule sets", async () => {
    for (const who of ["operator", "analyst", "marketing", "reader"] as const) {
      const create = await call(tokens[who], "POST", "/routing-rule-sets", {
        rules: RULE_SET_V1.rules,
        reason: "Try to change",
      });
      expect(create.statusCode, who).toBe(403);
      const activate = await call(tokens[who], "POST", "/routing-rule-sets/1/activate", {
        reason: "Try to change",
      });
      expect(activate.statusCode, who).toBe(403);
    }
    expect(
      (
        await call(tokens.lead, "POST", "/routing-rule-sets", {
          rules: RULE_SET_V1.rules,
          reason: "Allowed change",
        })
      ).statusCode,
    ).toBe(201);
  });

  it("requires a sign-in", async () => {
    const res = await fx.app.inject({ method: "GET", url: "/api/v1/offer-recommendations" });
    expect(res.statusCode).toBe(401);
  });
});
