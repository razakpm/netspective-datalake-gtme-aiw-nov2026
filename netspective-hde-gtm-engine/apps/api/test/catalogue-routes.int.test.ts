import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T066 (quickstart V26 and V27) over HTTP: PHI-like text is refused whole and stored nowhere, a stale
// lock number is a 409, and a repeated Idempotency-Key writes nothing twice.
let fx: IdentityFixture;
let lead: string;
let drafter: string;
const SSN = "Reach them on file 123-45-6789 about it.";
beforeEach(async () => {
  fx = await buildIdentityFixture();
  lead = (await fx.makeUser("lead@example.org", ["sales_service_lead"])).token;
  drafter = (await fx.makeUser("drafter@example.org", ["research_analyst"])).token;
});
afterEach(async () => {
  await fx.app.close();
});
let n = 0;
const call = (
  token: string | null,
  method: "GET" | "POST" | "PUT" | "PATCH",
  url: string,
  payload?: unknown,
  key: string | null = `routes-key-${++n}-padding`,
) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    payload: payload as object | undefined,
  });
const count = (table: string) =>
  (fx.db.raw.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;
const leaked = () =>
  /123-45-6789/.test(
    JSON.stringify([
      fx.db.raw.prepare("SELECT payload FROM outbox_event").all(),
      fx.db.raw.prepare("SELECT before_summary, after_summary FROM audit_event").all(),
      fx.db.raw.prepare("SELECT * FROM claim").all(),
      fx.db.raw.prepare("SELECT * FROM claim_evidence").all(),
      fx.db.raw.prepare("SELECT * FROM capability_delivery_example").all(),
      fx.db.raw.prepare("SELECT * FROM paid_engagement_deliverable").all(),
    ]),
  );

describe("PHI-like text", () => {
  it("is refused whole in a claim, a delivery example and a deliverable, and stored nowhere", async () => {
    const claim = await call(drafter, "POST", "/claims", { text: SSN });
    const example = await call(
      lead,
      "POST",
      "/service-capabilities/capability-01/delivery-examples",
      { text: SSN },
    );
    const deliverable = await call(
      lead,
      "POST",
      "/paid-engagement-types/input_audit/deliverables",
      { text: SSN },
    );
    for (const res of [claim, example, deliverable]) expect([400, 422]).toContain(res.statusCode);
    expect(count("claim")).toBe(0);
    expect(count("capability_delivery_example")).toBe(0);
    expect(count("paid_engagement_deliverable")).toBe(5);
    expect(leaked()).toBe(false);
  });

  it("is refused in a lint request and in an offer change", async () => {
    expect([400, 422]).toContain(
      (await call(lead, "POST", "/claims/lint", { text: SSN })).statusCode,
    );
    const change = await call(lead, "PATCH", "/offers/offer-2", {
      lockNo: 1,
      reason: "Edit",
      patch: { buyerOutput: SSN },
    });
    expect([400, 422]).toContain(change.statusCode);
    expect(count("offer_version")).toBe(10);
    expect(leaked()).toBe(false);
  });
});

describe("concurrent edits", () => {
  it("returns 409 for the second edit made with the same lock number", async () => {
    const first = await call(lead, "PATCH", "/offers/offer-2", {
      lockNo: 1,
      reason: "First edit",
      patch: { name: "A" },
    });
    expect(first.statusCode).toBe(201);
    const second = await call(lead, "PATCH", "/offers/offer-2", {
      lockNo: 1,
      reason: "Second edit",
      patch: { name: "B" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().detail).toMatch(/Reload/);
    expect(count("offer_version")).toBe(11);
  });

  it("returns 409 for a capability and a paid engagement type edited on a stale lock number", async () => {
    await call(lead, "PATCH", "/service-capabilities/capability-01", {
      lockNo: 1,
      attributes: { name: "A" },
    });
    expect(
      (
        await call(lead, "PATCH", "/service-capabilities/capability-01", {
          lockNo: 1,
          attributes: { name: "B" },
        })
      ).statusCode,
    ).toBe(409);
    await call(lead, "PATCH", "/paid-engagement-types/resilience_review", {
      lockNo: 1,
      scope: ["one environment"],
    });
    expect(
      (
        await call(lead, "PATCH", "/paid-engagement-types/resilience_review", {
          lockNo: 1,
          scope: ["another scope"],
        })
      ).statusCode,
    ).toBe(409);
  });
});

describe("Idempotency-Key", () => {
  it("replays the stored result for the same key and body, with no second effect", async () => {
    const body = { text: "We review sender feeds weekly." };
    const a = await call(drafter, "POST", "/claims", body, "same-key-0001-aaaa");
    const b = await call(drafter, "POST", "/claims", body, "same-key-0001-aaaa");
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    expect(count("claim")).toBe(1);
    expect(count("outbox_event")).toBe(1);
  });

  it("refuses the same key with a different body", async () => {
    await call(
      drafter,
      "POST",
      "/claims",
      { text: "We review sender feeds weekly." },
      "same-key-0002-aaaa",
    );
    const other = await call(
      drafter,
      "POST",
      "/claims",
      { text: "We map documents to FHIR." },
      "same-key-0002-aaaa",
    );
    expect(other.statusCode).toBe(422);
    expect(count("claim")).toBe(1);
  });

  it("is required on every change and refused when missing", async () => {
    expect(
      (await call(drafter, "POST", "/claims", { text: "We review sender feeds weekly." }, null))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          lead,
          "PUT",
          "/offers/offer-6/capacity",
          { periodKind: "month", limitSessions: 2 },
          null,
        )
      ).statusCode,
    ).toBe(400);
    expect(count("claim")).toBe(0);
    expect(count("offer_capacity")).toBe(2);
  });

  it("does not repeat a booking when the same key is sent twice", async () => {
    const date = new Date().toISOString().slice(0, 10);
    await call(
      lead,
      "POST",
      "/offers/offer-6/bookings",
      { sessionDate: date },
      "booking-key-0001-a",
    );
    await call(
      lead,
      "POST",
      "/offers/offer-6/bookings",
      { sessionDate: date },
      "booking-key-0001-a",
    );
    expect(count("offer_session_booking")).toBe(1);
  });
});
