import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RULE_SET_V1 } from "@gtm/domain";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T038: real responses are validated against specs/006-offer-routing-lead-magnet/contracts/routing.openapi.yaml.
const contract = new Contract("routing.openapi.yaml", "006-offer-routing-lead-magnet");
let fx: IdentityFixture;
let t: { lead: string; operator: string; reader: string };
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  t = {
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
    operator: (await fx.makeUser("operator@example.org", ["gtm_operator"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
});
afterEach(async () => {
  await fx.app.close();
});
type Method = "GET" | "POST";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `routing-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);
const account = () => {
  const at = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
    )
    .run(at, at);
  fx.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES ('cl1','a1','health_information_exchange',?)",
    )
    .run(at);
  return "a1";
};

describe("recommendations", () => {
  it("POST /accounts/{id}/offer-recommendations, GET list, GET one and GET the queue", async () => {
    const a = account();
    const made = await call(t.operator, "POST", `/accounts/${a}/offer-recommendations`, {});
    expect(made.statusCode).toBe(201);
    conforms("/accounts/{id}/offer-recommendations", "POST", made);
    const id = (made.json() as { id: string }).id;
    const list = await call(t.reader, "GET", `/accounts/${a}/offer-recommendations`);
    expect(list.statusCode).toBe(200);
    conforms("/accounts/{id}/offer-recommendations", "GET", list);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
    const one = await call(t.reader, "GET", `/offer-recommendations/${id}`);
    expect(one.statusCode).toBe(200);
    conforms("/offer-recommendations/{id}", "GET", one);
    const queue = await call(t.reader, "GET", "/offer-recommendations?state=pending");
    expect(queue.statusCode).toBe(200);
    conforms("/offer-recommendations", "GET", queue);
  });

  it("POST /offer-recommendations/{id}/review: accept and dismiss, and the refusal shapes", async () => {
    const a = account();
    const id = (
      (await call(t.operator, "POST", `/accounts/${a}/offer-recommendations`, {})).json() as {
        id: string;
      }
    ).id;
    const bad = await call(t.operator, "POST", `/offer-recommendations/${id}/review`, {
      decision: "dismiss",
    });
    expect(bad.statusCode).toBe(400);
    conforms("/offer-recommendations/{id}/review", "POST", bad);
    const ok = await call(t.operator, "POST", `/offer-recommendations/${id}/review`, {
      decision: "dismiss",
      reason: "Not now",
    });
    expect(ok.statusCode).toBe(200);
    conforms("/offer-recommendations/{id}/review", "POST", ok);
    const again = await call(t.operator, "POST", `/offer-recommendations/${id}/review`, {
      decision: "accept",
    });
    expect(again.statusCode).toBe(409);
    conforms("/offer-recommendations/{id}/review", "POST", again);
    const missing = await call(t.operator, "POST", "/offer-recommendations/nope/review", {
      decision: "accept",
    });
    expect(missing.statusCode).toBe(404);
    conforms("/offer-recommendations/{id}/review", "POST", missing);
  });

  it("refuses unknown accounts with a 404 problem", async () => {
    const res = await call(t.operator, "POST", "/accounts/nope/offer-recommendations", {});
    expect(res.statusCode).toBe(404);
    conforms("/accounts/{id}/offer-recommendations", "POST", res);
  });
});

describe("routing rule sets", () => {
  it("GET list, POST draft and POST activate", async () => {
    const list = await call(t.reader, "GET", "/routing-rule-sets");
    expect(list.statusCode).toBe(200);
    conforms("/routing-rule-sets", "GET", list);
    expect((list.json() as { items: { version: number }[] }).items[0]?.version).toBe(1);

    const draft = await call(t.lead, "POST", "/routing-rule-sets", {
      rules: RULE_SET_V1.rules,
      reason: "Same rules",
    });
    expect(draft.statusCode).toBe(201);
    conforms("/routing-rule-sets", "POST", draft);
    const activated = await call(t.lead, "POST", "/routing-rule-sets/2/activate", {
      reason: "Corpus passed",
    });
    expect(activated.statusCode).toBe(200);
    conforms("/routing-rule-sets/{version}/activate", "POST", activated);
    expect(activated.json()).toMatchObject({ version: 2, state: "active" });
  });

  it("refuses an invalid document and a failing corpus case", async () => {
    const invalid = await call(t.lead, "POST", "/routing-rule-sets", {
      rules: [],
      reason: "Nothing",
    });
    expect(invalid.statusCode).toBe(400);
    conforms("/routing-rule-sets", "POST", invalid);
    const broken = RULE_SET_V1.rules.map((r) =>
      r.id === "icp1-onboarding-friction"
        ? { ...r, then: { offerKey: "pilot-input-trace-workshop" } }
        : r,
    );
    await call(t.lead, "POST", "/routing-rule-sets", { rules: broken, reason: "Experiment" });
    const refused = await call(t.lead, "POST", "/routing-rule-sets/2/activate", {
      reason: "Trying it",
    });
    expect(refused.statusCode).toBe(422);
    expect((refused.json() as { codes: string[] }).codes).toContain("rules_tests_failed");
    conforms("/routing-rule-sets/{version}/activate", "POST", refused);
    const missing = await call(t.lead, "POST", "/routing-rule-sets/9/activate", {
      reason: "Unknown one",
    });
    expect(missing.statusCode).toBe(404);
    conforms("/routing-rule-sets/{version}/activate", "POST", missing);
    const notDraft = await call(t.lead, "POST", "/routing-rule-sets/1/activate", {
      reason: "Already active",
    });
    expect(notDraft.statusCode).toBe(409);
    conforms("/routing-rule-sets/{version}/activate", "POST", notDraft);
  });
});

describe("wait-lists", () => {
  it("POST add, GET list and POST close, with the refusal shapes", async () => {
    const a = account();
    const added = await call(t.operator, "POST", "/offers/offer-6/waitlist", {
      accountId: a,
      reason: "Offer 6 is full",
    });
    expect(added.statusCode).toBe(201);
    conforms("/offers/{id}/waitlist", "POST", added);
    const bad = await call(t.operator, "POST", "/offers/offer-6/waitlist", { accountId: a });
    expect(bad.statusCode).toBe(400);
    conforms("/offers/{id}/waitlist", "POST", bad);
    const denied = await call(t.reader, "POST", "/offers/offer-6/waitlist", {
      accountId: a,
      reason: "Not allowed",
    });
    expect(denied.statusCode).toBe(403);
    conforms("/offers/{id}/waitlist", "POST", denied);
    const missing = await call(t.operator, "POST", "/offers/offer-6/waitlist", {
      accountId: "nope",
      reason: "Unknown one",
    });
    expect(missing.statusCode).toBe(404);
    conforms("/offers/{id}/waitlist", "POST", missing);
    const list = await call(t.reader, "GET", "/offers/offer-6/waitlist");
    expect(list.statusCode).toBe(200);
    conforms("/offers/{id}/waitlist", "GET", list);
    const entry = (added.json() as { id: string }).id;
    const closed = await call(t.operator, "POST", `/offers/offer-6/waitlist/${entry}/close`, {
      state: "released",
      reason: "A place opened",
    });
    expect(closed.statusCode).toBe(200);
    conforms("/offers/{id}/waitlist/{entryId}/close", "POST", closed);
    const again = await call(t.operator, "POST", `/offers/offer-6/waitlist/${entry}/close`, {
      state: "removed",
      reason: "Twice over",
    });
    expect(again.statusCode).toBe(409);
    conforms("/offers/{id}/waitlist/{entryId}/close", "POST", again);
    const nope = await call(t.operator, "POST", "/offers/offer-6/waitlist/nope/close", {
      state: "removed",
      reason: "Nothing here",
    });
    expect(nope.statusCode).toBe(404);
    conforms("/offers/{id}/waitlist/{entryId}/close", "POST", nope);
  });
});
