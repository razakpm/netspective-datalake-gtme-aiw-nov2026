import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { FULL_CAPABILITY } from "../../test-support/catalogue-harness.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T061: real responses are validated against specs/005-capabilities-offers-claims/contracts/capabilities.openapi.yaml.
const contract = new Contract("capabilities.openapi.yaml", "005-capabilities-offers-claims");
let fx: IdentityFixture;
let t: { lead: string; reader: string };
let n = 0;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  t = {
    lead: (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
});
afterEach(async () => {
  await fx.app.close();
});
type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
const call = (token: string, method: Method, url: string, payload?: unknown) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `contract-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);
const ID = "/service-capabilities/capability-01";

describe("capabilities", () => {
  it("GET /service-capabilities and GET /service-capabilities/{id}", async () => {
    const list = await call(t.reader, "GET", "/service-capabilities");
    expect(list.statusCode).toBe(200);
    conforms("/service-capabilities", "GET", list);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(19);
    const one = await call(t.reader, "GET", ID);
    expect(one.statusCode).toBe(200);
    conforms("/service-capabilities/{id}", "GET", one);
    expect(JSON.stringify(one.json())).not.toContain("deliveryExamples");
  });

  it("PATCH, evidence and delivery examples", async () => {
    const patched = await call(t.lead, "PATCH", ID, { lockNo: 1, attributes: FULL_CAPABILITY });
    expect(patched.statusCode).toBe(200);
    conforms("/service-capabilities/{id}", "PATCH", patched);
    const ev = await call(t.lead, "POST", `${ID}/evidence`, {
      basisKind: "delivery_record",
      reference: "rec-1",
      note: "Two senders",
    });
    expect(ev.statusCode).toBe(201);
    conforms("/service-capabilities/{id}/evidence", "POST", ev);
    const ex = await call(t.lead, "POST", `${ID}/delivery-examples`, {
      text: "An internal delivery note",
    });
    expect(ex.statusCode).toBe(201);
    conforms("/service-capabilities/{id}/delivery-examples", "POST", ex);
    const asLead = await call(t.lead, "GET", ID);
    expect((asLead.json() as { deliveryExamples: unknown[] }).deliveryExamples).toHaveLength(1);
    conforms("/service-capabilities/{id}", "GET", asLead);
  });

  it("links and unlinks an offer", async () => {
    const link = await call(t.lead, "PUT", `${ID}/offers/offer-1`);
    expect(link.statusCode).toBe(204);
    const one = await call(t.reader, "GET", ID);
    expect((one.json() as { offers: unknown[] }).offers).toHaveLength(1);
    conforms("/service-capabilities/{id}", "GET", one);
    const unlink = await call(t.lead, "DELETE", `${ID}/offers/offer-1`);
    expect(unlink.statusCode).toBe(204);
  });

  it("PUT public-claim-status approves with complete attributes, evidence and an approved claim", async () => {
    await call(t.lead, "PATCH", ID, { lockNo: 1, attributes: FULL_CAPABILITY });
    await call(t.lead, "POST", `${ID}/evidence`, {
      basisKind: "delivery_record",
      reference: "rec-1",
    });
    const claimId = "claim-contract-1";
    const at = new Date().toISOString();
    fx.db.raw
      .prepare(
        "INSERT INTO claim (id, text, declared_class, effective_class, status, drafted_by, drafted_at, version_no) VALUES (?, 'We map CCDA documents to FHIR.', NULL, 'general', 'approved', 'someone', ?, 1)",
      )
      .run(claimId, at);
    fx.db.raw
      .prepare(
        "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at) VALUES ('ev-c1', ?, 'document', 'doc', 'owner', 'someone', ?, '2099-01-01T00:00:00.000Z')",
      )
      .run(claimId, at);
    const refused = await call(t.lead, "PUT", `${ID}/public-claim-status`, { status: "approved" });
    expect(refused.statusCode).toBe(409);
    conforms("/service-capabilities/{id}/public-claim-status", "PUT", refused);
    const ok = await call(t.lead, "PUT", `${ID}/public-claim-status`, {
      status: "approved",
      claimId,
    });
    expect(ok.statusCode).toBe(200);
    conforms("/service-capabilities/{id}/public-claim-status", "PUT", ok);
    expect(ok.json()).toMatchObject({
      publicClaimStatus: "approved",
      publicClaimNeedsReview: false,
    });
  });

  it("documents the refusals as problem details", async () => {
    const forbidden = await call(t.reader, "PATCH", ID, { lockNo: 1, attributes: { name: "A" } });
    expect(forbidden.statusCode).toBe(403);
    conforms("/service-capabilities/{id}", "PATCH", forbidden);
    const bad = await call(t.lead, "PATCH", ID, { lockNo: 1, attributes: { price: "9" } });
    expect(bad.statusCode).toBe(400);
    conforms("/service-capabilities/{id}", "PATCH", bad);
    const missing = await call(t.reader, "GET", "/service-capabilities/capability-99");
    expect(missing.statusCode).toBe(404);
    conforms("/service-capabilities/{id}", "GET", missing);
    await call(t.lead, "PATCH", ID, { lockNo: 1, attributes: { name: "A" } });
    const stale = await call(t.lead, "PATCH", ID, { lockNo: 1, attributes: { name: "B" } });
    expect(stale.statusCode).toBe(409);
    conforms("/service-capabilities/{id}", "PATCH", stale);
  });
});
