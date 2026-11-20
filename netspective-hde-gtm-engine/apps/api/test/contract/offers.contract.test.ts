import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOUNDATION_ROLE_PERMISSIONS } from "@gtm/domain";
import { Contract } from "../../test-support/openapi-contract.js";
import { COMPLETE_PATCH } from "../../test-support/catalogue-harness.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T060: real responses are validated against specs/005-capabilities-offers-claims/contracts/offers.openapi.yaml.
const contract = new Contract("offers.openapi.yaml", "005-capabilities-offers-claims");
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
type Method = "GET" | "POST" | "PUT" | "PATCH";
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
const leadActor = () => ({
  userId: "seed-lead",
  actorType: "human" as const,
  correlationId: null,
  permissions: FOUNDATION_ROLE_PERMISSIONS.sales_service_lead,
});
const today = () => new Date().toISOString().slice(0, 10);

describe("offers and versions", () => {
  it("GET /offers and GET /offers/{id}", async () => {
    const list = await call(t.reader, "GET", "/offers");
    expect(list.statusCode).toBe(200);
    conforms("/offers", "GET", list);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(10);
    const one = await call(t.reader, "GET", "/offers/offer-7");
    expect(one.statusCode).toBe(200);
    conforms("/offers/{id}", "GET", one);
  });

  it("PATCH /offers/{id}, GET versions and the status move", async () => {
    const changed = await call(t.lead, "PATCH", "/offers/offer-2", {
      lockNo: 1,
      reason: "Complete the offer",
      patch: COMPLETE_PATCH,
    });
    expect(changed.statusCode).toBe(201);
    conforms("/offers/{id}", "PATCH", changed);
    const versions = await call(t.reader, "GET", "/offers/offer-2/versions");
    expect(versions.statusCode).toBe(200);
    conforms("/offers/{id}/versions", "GET", versions);
    const moved = await call(t.lead, "POST", "/offers/offer-2/versions/2/status", {
      to: "internally_reviewed",
      note: "Looks right",
    });
    expect(moved.statusCode).toBe(200);
    conforms("/offers/{id}/versions/{versionNo}/status", "POST", moved);
  });

  it("acknowledges a limitation", async () => {
    const ack = await call(
      t.lead,
      "POST",
      "/offers/offer-7/limitations/limitation-offer-7-evaluation/acknowledge",
    );
    expect(ack.statusCode).toBe(200);
    conforms("/offers/{id}/limitations/{limitationId}/acknowledge", "POST", ack);
    const wrongOffer = await call(
      t.lead,
      "POST",
      "/offers/offer-1/limitations/limitation-offer-7-evaluation/acknowledge",
    );
    expect(wrongOffer.statusCode).toBe(404);
    conforms("/offers/{id}/limitations/{limitationId}/acknowledge", "POST", wrongOffer);
  });

  it("documents the refusals as problem details", async () => {
    const forbidden = await call(t.reader, "PATCH", "/offers/offer-2", {
      lockNo: 1,
      reason: "Try it",
      patch: { name: "A" },
    });
    expect(forbidden.statusCode).toBe(403);
    conforms("/offers/{id}", "PATCH", forbidden);
    const stale = await call(t.lead, "PATCH", "/offers/offer-2", {
      lockNo: 9,
      reason: "Stale try",
      patch: { name: "A" },
    });
    expect(stale.statusCode).toBe(409);
    conforms("/offers/{id}", "PATCH", stale);
    const missing = await call(t.reader, "GET", "/offers/offer-99");
    expect(missing.statusCode).toBe(404);
    conforms("/offers/{id}", "GET", missing);
    const refused = await call(t.lead, "POST", "/offers/offer-2/versions/1/status", {
      to: "available",
      note: "Skip ahead",
    });
    expect(refused.statusCode).toBe(409);
    conforms("/offers/{id}/versions/{versionNo}/status", "POST", refused);
  });
});

describe("capacity and bookings", () => {
  it("GET and PUT capacity and the status read by feature 006", async () => {
    const got = await call(t.reader, "GET", "/offers/offer-6/capacity");
    expect(got.statusCode).toBe(200);
    conforms("/offers/{id}/capacity", "GET", got);
    const put = await call(t.lead, "PUT", "/offers/offer-6/capacity", {
      periodKind: "month",
      limitSessions: 4,
      reason: "More room",
    });
    expect(put.statusCode).toBe(200);
    conforms("/offers/{id}/capacity", "PUT", put);
    const status = await call(t.reader, "GET", "/offers/offer-6/capacity/status");
    expect(status.statusCode).toBe(200);
    conforms("/offers/{id}/capacity/status", "GET", status);
    expect(status.json()).toMatchObject({ state: "room", limit: 4 });
    const at = await call(
      t.reader,
      "GET",
      "/offers/offer-6/capacity/status?at=2027-01-15T10:00:00Z",
    );
    expect(at.statusCode).toBe(200);
    conforms("/offers/{id}/capacity/status", "GET", at);
  });

  it("records, lists, reschedules and cancels bookings, and is refused when full", async () => {
    const date = today();
    const created = await call(t.lead, "POST", "/offers/offer-6/bookings", {
      sessionDate: date,
      externalRef: "ws-1",
    });
    expect(created.statusCode).toBe(201);
    conforms("/offers/{id}/bookings", "POST", created);
    const id = (created.json() as { id: string }).id;
    const list = await call(t.reader, "GET", "/offers/offer-6/bookings");
    expect(list.statusCode).toBe(200);
    conforms("/offers/{id}/bookings", "GET", list);
    expect((list.json() as { items: unknown[] }).items).toHaveLength(1);
    const moved = await call(t.lead, "PATCH", `/offers/offer-6/bookings/${id}`, {
      sessionDate: date,
    });
    expect(moved.statusCode).toBe(200);
    conforms("/offers/{id}/bookings/{bookingId}", "PATCH", moved);
    const held = await call(t.lead, "PATCH", `/offers/offer-6/bookings/${id}`, {
      state: "cancelled",
    });
    expect(held.statusCode).toBe(200);
    conforms("/offers/{id}/bookings/{bookingId}", "PATCH", held);
    await call(t.lead, "PUT", "/offers/offer-6/capacity", {
      periodKind: "month",
      limitSessions: 0,
      reason: "Pause bookings",
    });
    const full = await call(t.lead, "POST", "/offers/offer-6/bookings", { sessionDate: date });
    expect(full.statusCode).toBe(409);
    conforms("/offers/{id}/bookings", "POST", full);
  });
});

describe("scores and paid engagement types", () => {
  it("GET and PUT /offer-scores", async () => {
    const empty = await call(t.reader, "GET", "/offer-scores");
    expect(empty.statusCode).toBe(200);
    conforms("/offer-scores", "GET", empty);
    fx.catalogue.scores.addCriterion(leadActor(), {
      key: "buyer_pull",
      label: "Buyer pull",
      position: 1,
    });
    const put = await call(t.lead, "PUT", "/offer-scores", {
      offerId: "offer-1",
      criterionKey: "buyer_pull",
      score: 3,
      rationale: "Early signs",
    });
    expect(put.statusCode).toBe(200);
    conforms("/offer-scores", "PUT", put);
    expect((put.json() as { scores: { status: string }[] }).scores[0]?.status).toBe("hypothesis");
  });

  it("lists, edits and extends paid engagement types, and decides a deliverable", async () => {
    const list = await call(t.reader, "GET", "/paid-engagement-types");
    expect(list.statusCode).toBe(200);
    conforms("/paid-engagement-types", "GET", list);
    const patch = await call(t.lead, "PATCH", "/paid-engagement-types/resilience_review", {
      lockNo: 1,
      scope: ["one environment"],
    });
    expect(patch.statusCode).toBe(200);
    conforms("/paid-engagement-types/{key}", "PATCH", patch);
    const bad = await call(t.lead, "PATCH", "/paid-engagement-types/resilience_review", {
      lockNo: 2,
      price: "10",
    });
    expect(bad.statusCode).toBe(400);
    conforms("/paid-engagement-types/{key}", "PATCH", bad);
    const proposed = await call(t.lead, "POST", "/paid-engagement-types/input_audit/deliverables", {
      text: "A weekly status call",
    });
    expect(proposed.statusCode).toBe(201);
    conforms("/paid-engagement-types/{key}/deliverables", "POST", proposed);
    const id = (
      proposed.json() as { deliverables: { id: string; text: string }[] }
    ).deliverables.find((d) => d.text === "A weekly status call")!.id;
    const decided = await call(
      t.lead,
      "POST",
      `/paid-engagement-types/input_audit/deliverables/${id}/decision`,
      { decision: "approve", note: "Agreed" },
    );
    expect(decided.statusCode).toBe(200);
    conforms("/paid-engagement-types/{key}/deliverables/{deliverableId}/decision", "POST", decided);
    expect(JSON.stringify(list.json())).not.toMatch(/"(price|fee|rate|currency)"/);
  });
});
