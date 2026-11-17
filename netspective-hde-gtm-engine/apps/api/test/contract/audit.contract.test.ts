import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

const contract = new Contract("audit.openapi.yaml");
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
async function get(token: string, query = "") {
  return fx.app.inject({
    method: "GET",
    url: `/api/v1/audit-events${query}`,
    headers: bearer(token),
  });
}
const conforms = (res: Awaited<ReturnType<typeof get>>) =>
  expect(
    contract.check(
      "/audit-events",
      "get",
      res.statusCode,
      String(res.headers["content-type"]),
      res.json(),
    ),
  ).toEqual([]);

describe("GET /audit-events", () => {
  it("answers a caller without audit.read with 403 and one denied event", async () => {
    const u = await fx.makeUser("op@example.org", ["gtm_operator"]);
    const res = await get(u.token);
    expect(res.statusCode).toBe(403);
    conforms(res);
    const denied = fx.db.raw
      .prepare("SELECT action, actor_id FROM audit_event WHERE outcome = 'denied'")
      .all();
    expect(denied).toEqual([{ action: "audit.read.denied", actor_id: u.id }]);
  });

  it("returns 401 without a token", async () => {
    const res = await fx.app.inject({ method: "GET", url: "/api/v1/audit-events" });
    expect(res.statusCode).toBe(401);
    conforms(res);
  });

  it("lists events newest first, contract-valid, with parsed summaries", async () => {
    const reader = await fx.makeUser("exec@example.org", ["read_only_executive"]);
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: { ...bearer(admin.token), "idempotency-key": "audit-key-0001" },
      payload: { email: "new@example.org", roles: ["gtm_operator"] },
    });
    const res = await get(reader.token);
    expect(res.statusCode).toBe(200);
    conforms(res);
    const items = res.json().items as {
      action: string;
      afterSummary: unknown;
      occurredAt: string;
    }[];
    expect(items[0]!.action).toBe("user.invited");
    expect(items[0]!.afterSummary).toEqual({ status: "invited", roles: ["gtm_operator"] });
    const times = items.map((i) => i.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it("filters by entity, actor, correlation id and time range", async () => {
    const reader = await fx.makeUser("exec@example.org", ["read_only_executive"]);
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const invite = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: {
        ...bearer(admin.token),
        "idempotency-key": "audit-key-0001",
        "x-correlation-id": "corr-audit-0001",
      },
      payload: { email: "new@example.org" },
    });
    const newId = invite.json().id as string;

    const byEntity = (await get(reader.token, `?entityType=user&entityId=${newId}`)).json().items;
    expect(byEntity.map((e: { action: string }) => e.action)).toEqual(["user.invited"]);

    const byActor = (await get(reader.token, `?actorId=${admin.id}`)).json().items;
    expect(byActor.length).toBeGreaterThan(0);
    expect(byActor.every((e: { actorId: string }) => e.actorId === admin.id)).toBe(true);

    const byCorrelation = (await get(reader.token, "?correlationId=corr-audit-0001")).json().items;
    expect(byCorrelation).toHaveLength(1);

    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect((await get(reader.token, `?from=${encodeURIComponent(future)}`)).json().items).toEqual(
      [],
    );
    expect(
      (await get(reader.token, `?to=${encodeURIComponent("2000-01-01T00:00:00Z")}`)).json().items,
    ).toEqual([]);
  });

  it("paginates with a cursor", async () => {
    const reader = await fx.makeUser("exec@example.org", ["read_only_executive"]);
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    for (let i = 0; i < 3; i++) {
      await fx.app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: { ...bearer(admin.token), "idempotency-key": `audit-key-000${i}` },
        payload: { email: `u${i}@example.org` },
      });
    }
    const first = (await get(reader.token, "?limit=2")).json();
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await get(reader.token, `?limit=2&cursor=${first.nextCursor}`)).json();
    const ids = [...first.items, ...second.items].map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rejects invalid filters without echoing them", async () => {
    const reader = await fx.makeUser("exec@example.org", ["read_only_executive"]);
    const res = await get(reader.token, "?from=not-a-date&limit=9999");
    expect(res.statusCode).toBe(400);
    conforms(res);
    expect(res.body).not.toContain("not-a-date");
  });

  it("offers no way to create, change or delete events", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
      const res = await fx.app.inject({
        method,
        url: "/api/v1/audit-events",
        headers: bearer(admin.token),
        payload: {},
      });
      expect([404, 405]).toContain(res.statusCode);
    }
  });
});
