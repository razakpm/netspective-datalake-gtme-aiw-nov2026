import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

const contract = new Contract("quarantine.openapi.yaml");
let fx: IdentityFixture;
let reviewer: { id: string; token: string };
let outsider: { id: string; token: string };

beforeEach(async () => {
  fx = await buildIdentityFixture({ quarantineEntryPoints: ["api_body"] });
  // The foundation matrix gives quarantine.review to administrators only (open question #27).
  reviewer = await fx.makeUser("reviewer@example.org", ["administrator"]);
  outsider = await fx.makeUser("outsider@example.org", ["gtm_operator"]);
});
afterEach(async () => {
  await fx.app.close();
});

const h = (token: string) => ({ authorization: `Bearer ${token}` });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);

async function submitPhi(): Promise<string> {
  const res = await fx.app.inject({
    method: "POST",
    url: "/api/v1/users",
    payload: { email: "a@example.org", displayName: "ssn 000-12-3456" },
  });
  expect(res.statusCode).toBe(202);
  expect(res.json()).toMatchObject({ status: "quarantined" });
  expect(res.body).not.toContain("000-12-3456");
  return (fx.quarantine.list()[0] as { id: string }).id;
}

describe("quarantine at an entry point configured for review", () => {
  it("holds the content instead of rejecting it, leaving a decision, an audit event and no clear text", async () => {
    await submitPhi();
    expect(fx.db.raw.prepare("SELECT decision FROM phi_guard_decision").all()).toEqual([
      { decision: "quarantine" },
    ]);
    expect(fx.db.raw.prepare("SELECT action FROM audit_event").all()).toEqual([
      { action: "phi.quarantined" },
    ]);
    const dump =
      JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all()) + fx.logs.join("");
    expect(dump).not.toContain("000-12-3456");
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM \"user\" WHERE email = 'a@example.org'").get(),
    ).toEqual({ c: 0 });
  });
});

describe("quarantine routes", () => {
  it("refuses everyone without quarantine.review, with a denied event each", async () => {
    const id = await submitPhi();
    for (const [method, url, payload] of [
      ["GET", "/api/v1/quarantine-items", undefined],
      ["GET", `/api/v1/quarantine-items/${id}`, undefined],
      ["POST", `/api/v1/quarantine-items/${id}/content`, { purpose: "peek at it" }],
      ["POST", `/api/v1/quarantine-items/${id}/release`, { reason: "just because" }],
      ["POST", `/api/v1/quarantine-items/${id}/discard`, { reason: "just because" }],
      ["GET", "/api/v1/phi-decisions", undefined],
    ] as const) {
      const res = await fx.app.inject({
        method,
        url,
        headers: h(outsider.token),
        ...(payload ? { payload } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      conforms(url.replace("/api/v1", "").replace(id, "{id}"), method.toLowerCase(), res);
    }
    expect(
      (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c,
    ).toBe(6);
    expect(fx.db.raw.prepare("SELECT count(*) c FROM quarantine_access").get()).toEqual({ c: 0 });
  });

  it("lists metadata only and shows the content only through the audited view", async () => {
    const id = await submitPhi();
    const list = await fx.app.inject({
      method: "GET",
      url: "/api/v1/quarantine-items",
      headers: h(reviewer.token),
    });
    conforms("/quarantine-items", "get", list);
    expect(list.body).not.toContain("000-12-3456");
    expect(list.json().items[0].ruleIds).toEqual(["PHI.SSN"]);

    const meta = await fx.app.inject({
      method: "GET",
      url: `/api/v1/quarantine-items/${id}`,
      headers: h(reviewer.token),
    });
    conforms("/quarantine-items/{id}", "get", meta);
    expect(meta.body).not.toContain("000-12-3456");

    const view = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${id}/content`,
      headers: h(reviewer.token),
      payload: { purpose: "checking for false positive" },
    });
    conforms("/quarantine-items/{id}/content", "post", view);
    expect(view.json().content).toContain("000-12-3456");
    expect(fx.db.raw.prepare("SELECT count(*) c FROM quarantine_access").get()).toEqual({ c: 1 });
    expect(
      fx.db.raw
        .prepare("SELECT count(*) c FROM audit_event WHERE action = 'quarantine.viewed'")
        .get(),
    ).toEqual({ c: 1 });
    expect(JSON.stringify(fx.db.raw.prepare("SELECT * FROM audit_event").all())).not.toContain(
      "000-12-3456",
    );
  });

  it("releases and discards with a reason, and rejects a missing reason", async () => {
    const a = await submitPhi();
    const bad = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${a}/release`,
      headers: h(reviewer.token),
      payload: {},
    });
    expect(bad.statusCode).toBe(400);

    const release = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${a}/release`,
      headers: h(reviewer.token),
      payload: { reason: "benign near-miss" },
    });
    conforms("/quarantine-items/{id}/release", "post", release);
    expect(release.json().status).toBe("released");
    const again = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${a}/discard`,
      headers: h(reviewer.token),
      payload: { reason: "too late" },
    });
    expect(again.statusCode).toBe(409);
    conforms("/quarantine-items/{id}/discard", "post", again);

    const b = await submitPhi();
    void b;
    const items = fx.quarantine.list("held");
    const discard = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${items[0]!.id}/discard`,
      headers: h(reviewer.token),
      payload: { reason: "real PHI, destroy" },
    });
    conforms("/quarantine-items/{id}/discard", "post", discard);
    expect(discard.json()).toMatchObject({ status: "discarded", contentPurged: true });
  });

  it("returns 410 when the content was purged", async () => {
    const id = await submitPhi();
    fx.db.raw.prepare("UPDATE quarantine_item SET content_encrypted = NULL").run();
    const res = await fx.app.inject({
      method: "POST",
      url: `/api/v1/quarantine-items/${id}/content`,
      headers: h(reviewer.token),
      payload: { purpose: "check it later" },
    });
    expect(res.statusCode).toBe(410);
    conforms("/quarantine-items/{id}/content", "post", res);
  });

  it("exposes guard decisions as metadata only", async () => {
    await submitPhi();
    const res = await fx.app.inject({
      method: "GET",
      url: "/api/v1/phi-decisions",
      headers: h(reviewer.token),
    });
    conforms("/phi-decisions", "get", res);
    expect(res.json().items[0]).toMatchObject({ decision: "quarantine", ruleIds: ["PHI.SSN"] });
    expect(res.body).not.toContain("000-12-3456");
  });
});
