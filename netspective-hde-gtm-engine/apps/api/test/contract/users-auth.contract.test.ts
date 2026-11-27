import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

const users = new Contract("users.openapi.yaml");
const auth = new Contract("auth.openapi.yaml");

let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const bearer = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  ...(key ? { "idempotency-key": key } : {}),
});

function conforms(
  contract: Contract,
  path: string,
  method: string,
  res: LightMyRequestResponse,
): void {
  const body: unknown = res.body ? res.json() : undefined;
  expect(
    contract.check(path, method, res.statusCode, String(res.headers["content-type"]), body),
  ).toEqual([]);
}

const auditRows = (where = "1=1") =>
  fx.db.raw.prepare(`SELECT action, outcome, actor_id FROM audit_event WHERE ${where}`).all() as {
    action: string;
    outcome: string;
    actor_id: string | null;
  }[];

describe("authentication", () => {
  it("returns 401 without a token, with a bad token and with an expired token", async () => {
    for (const headers of [
      {},
      { authorization: "Bearer not-a-token" },
      {
        authorization: `Bearer ${await fx.tokenFor("idp|x", "x@example.org", { expiresInSeconds: -60 })}`,
      },
    ]) {
      const res = await fx.app.inject({ method: "GET", url: "/api/v1/auth/me", headers });
      expect(res.statusCode).toBe(401);
      conforms(auth, "/auth/me", "get", res);
    }
  });

  it("returns 403 and no session for users who are not invited", async () => {
    const token = await fx.tokenFor("idp|stranger", "stranger@example.org");
    const res = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/session/check",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
    conforms(auth, "/auth/session/check", "get", res);
    expect(auditRows("action = 'auth.denied'")).toHaveLength(1);
    expect(fx.db.raw.prepare('SELECT count(*) c FROM "user"').get()).toEqual({ c: 0 });
  });

  it("returns 403 for deactivated users", async () => {
    const u = await fx.makeUser("gone@example.org", [], "deactivated");
    const res = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(u.token),
    });
    expect(res.statusCode).toBe(403);
    conforms(auth, "/auth/me", "get", res);
  });

  it("returns 503 for new sign-ins when keys are unavailable, but keeps cached sessions", async () => {
    const u = await fx.makeUser("ok@example.org");
    // Warm the verifier's key cache, then take the provider down.
    expect(
      (await fx.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(u.token) }))
        .statusCode,
    ).toBe(200);
    fx.idp.available = false;
    expect(
      (await fx.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: bearer(u.token) }))
        .statusCode,
    ).toBe(200);
  });

  it("returns 503 for a new sign-in when the provider keys cannot be fetched", async () => {
    const u = await fx.makeUser("first@example.org");
    fx.idp.available = false;
    const res = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/session/check",
      headers: bearer(u.token),
    });
    expect(res.statusCode).toBe(503);
    conforms(auth, "/auth/session/check", "get", res);
  });

  it("activates an invited user at first sign-in", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const invite = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(admin.token, "invite-key-0001"),
      payload: { email: "New.Person@Example.org", roles: ["gtm_operator"] },
    });
    expect(invite.statusCode).toBe(201);
    expect(invite.json().status).toBe("invited");
    expect(invite.json().email).toBe("new.person@example.org");

    const token = await fx.tokenFor("idp|new-person", "new.person@example.org");
    const me = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
    });
    expect(me.statusCode).toBe(200);
    conforms(auth, "/auth/me", "get", me);
    expect(me.json()).toMatchObject({
      status: "active",
      roles: ["gtm_operator"],
      permissions: expect.arrayContaining(["jobs.read", "webhooks.read", "accounts.import"]),
    });
    expect(auditRows("action = 'user.activated'")).toHaveLength(1);
  });

  it("refuses an invitation that has expired", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(admin.token, "invite-key-0001"),
      payload: { email: "late@example.org" },
    });
    fx.db.raw.exec("UPDATE invitation SET expires_at = '2000-01-01T00:00:00.000Z'");
    const token = await fx.tokenFor("idp|late", "late@example.org");
    const res = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("returns exactly the union of permissions for two roles, and 403 on user management", async () => {
    const u = await fx.makeUser("multi@example.org", ["gtm_operator", "read_only_executive"]);
    const me = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(u.token),
    });
    conforms(auth, "/auth/me", "get", me);
    expect(me.json().permissions).toEqual(
      [
        "accounts.edit",
        "accounts.import",
        "accounts.read",
        "ai_invocations.read",
        "audit.read",
        "capabilities.read",
        "claims.draft",
        "claims.read",
        "contacts.edit",
        "contacts.import",
        "contacts.read",
        "evidence.record",
        "hypotheses.edit",
        "hypotheses.read",
        "icp.assess",
        "icp.read",
        "jobs.read",
        "offers.read",
        "offers.recommend",
        "requests.read",
        "requests.review",
        "research.read",
        "research.run",
        "review.decide",
        "signals.read",
        "signals.record",
        "stakeholders.edit",
        "waitlist.edit",
        "webhooks.read",
        "workshops.edit",
        "workshops.read",
      ].sort(),
    );
    const post = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(u.token, "denied-key-0001"),
      payload: { email: "x@example.org" },
    });
    expect(post.statusCode).toBe(403);
  });

  it("lets a user with zero roles authenticate but access nothing", async () => {
    const u = await fx.makeUser("none@example.org");
    const me = await fx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: bearer(u.token),
    });
    expect(me.json()).toMatchObject({ roles: [], permissions: [] });
  });
});

describe("authorisation (SC-001)", () => {
  it("answers a non-administrator with 403 and exactly one denied audit event", async () => {
    const u = await fx.makeUser("operator@example.org", ["gtm_operator"]);
    const res = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(u.token, "denied-key-0001"),
      payload: { email: "x@example.org" },
    });
    expect(res.statusCode).toBe(403);
    conforms(users, "/users", "post", res);
    expect(auditRows("outcome = 'denied'")).toEqual([
      { action: "users.manage.denied", outcome: "denied", actor_id: u.id },
    ]);
    expect(fx.db.raw.prepare('SELECT count(*) c FROM "user"').get()).toEqual({ c: 1 });
  });

  it("protects every users operation", async () => {
    const u = await fx.makeUser("operator@example.org", ["gtm_operator"]);
    const id = "018f0000-0000-7000-8000-000000000000";
    for (const [method, url] of [
      ["GET", "/api/v1/users"],
      ["GET", `/api/v1/users/${id}`],
      ["PUT", `/api/v1/users/${id}/roles`],
      ["POST", `/api/v1/users/${id}/deactivate`],
      ["POST", `/api/v1/users/${id}/reactivate`],
      ["GET", "/api/v1/roles"],
    ] as const) {
      const res = await fx.app.inject({
        method,
        url,
        headers: bearer(u.token, "denied-key-0001"),
        ...(method === "PUT" ? { payload: { roles: [] } } : {}),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
  });
});

describe("users operations", () => {
  it("covers invite, list, get, set roles, deactivate, reactivate and roles with contract-valid responses", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const h = (key: string) => bearer(admin.token, key);

    const invite = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: h("key-invite-1"),
      payload: { email: "a@example.org", displayName: "A Example" },
    });
    expect(invite.statusCode).toBe(201);
    conforms(users, "/users", "post", invite);
    const id = invite.json().id as string;

    const list = await fx.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: bearer(admin.token),
    });
    conforms(users, "/users", "get", list);
    expect(list.json().items).toHaveLength(2);

    const get = await fx.app.inject({
      method: "GET",
      url: `/api/v1/users/${id}`,
      headers: bearer(admin.token),
    });
    conforms(users, "/users/{userId}", "get", get);

    const roles = await fx.app.inject({
      method: "PUT",
      url: `/api/v1/users/${id}/roles`,
      headers: h("key-roles-01"),
      payload: { roles: ["research_analyst", "gtm_operator"] },
    });
    expect(roles.statusCode).toBe(200);
    conforms(users, "/users/{userId}/roles", "put", roles);
    expect(roles.json().roles).toEqual(["gtm_operator", "research_analyst"]);

    const off = await fx.app.inject({
      method: "POST",
      url: `/api/v1/users/${id}/deactivate`,
      headers: h("key-deact-01"),
    });
    conforms(users, "/users/{userId}/deactivate", "post", off);
    expect(off.json().status).toBe("deactivated");

    const on = await fx.app.inject({
      method: "POST",
      url: `/api/v1/users/${id}/reactivate`,
      headers: h("key-react-01"),
    });
    conforms(users, "/users/{userId}/reactivate", "post", on);
    expect(on.json().status).toBe("active");

    const rolesList = await fx.app.inject({
      method: "GET",
      url: "/api/v1/roles",
      headers: bearer(admin.token),
    });
    conforms(users, "/roles", "get", rolesList);
    expect(rolesList.json()).toHaveLength(7);

    // one audit event per successful change
    expect(auditRows("action LIKE 'user.%'").map((r) => r.action)).toEqual([
      "user.invited",
      "user.roles.set",
      "user.deactivated",
      "user.reactivated",
    ]);
  });

  it("returns 404 problems for an unknown user and 409 for a duplicate email", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const missing = await fx.app.inject({
      method: "GET",
      url: "/api/v1/users/018f0000-0000-7000-8000-000000000000",
      headers: bearer(admin.token),
    });
    expect(missing.statusCode).toBe(404);
    conforms(users, "/users/{userId}", "get", missing);
    const dup = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(admin.token, "key-dup-0001"),
      payload: { email: "ADMIN@example.org" },
    });
    expect(dup.statusCode).toBe(409);
    conforms(users, "/users", "post", dup);
  });

  it("rejects invalid bodies without echoing them and blocks PHI", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const bad = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(admin.token, "key-bad-0001"),
      payload: { email: "nope", roles: ["superuser"], extra: 1 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.body).not.toContain("superuser");
    const phi = await fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(admin.token, "key-phi-0001"),
      payload: { email: "p@example.org", displayName: "ssn 000-12-3456" },
    });
    expect(phi.statusCode).toBe(422);
    expect(phi.body).not.toContain("000-12-3456");
    expect(fx.db.raw.prepare('SELECT count(*) c FROM "user"').get()).toEqual({ c: 1 });
  });

  it("requires a valid Idempotency-Key", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    for (const key of [undefined, "short"]) {
      const res = await fx.app.inject({
        method: "POST",
        url: "/api/v1/users",
        headers: bearer(admin.token, key),
        payload: { email: "k@example.org" },
      });
      expect(res.statusCode).toBe(400);
    }
  });
});

describe("API idempotency (FR-055, SC-015)", () => {
  async function invite(token: string, key: string, email: string) {
    return fx.app.inject({
      method: "POST",
      url: "/api/v1/users",
      headers: bearer(token, key),
      payload: { email },
    });
  }

  it("replays the original result for the same key and body, with no second user", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const first = await invite(admin.token, "same-key-0001", "r@example.org");
    const second = await invite(admin.token, "same-key-0001", "r@example.org");
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    conforms(users, "/users", "post", second);
    expect(second.json()).toEqual(first.json());
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM \"user\" WHERE email = 'r@example.org'").get(),
    ).toEqual({ c: 1 });
    expect(auditRows("action = 'user.invited'")).toHaveLength(1);
  });

  it("rejects the same key with a different body (422)", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    await invite(admin.token, "same-key-0001", "r@example.org");
    const other = await invite(admin.token, "same-key-0001", "different@example.org");
    expect(other.statusCode).toBe(422);
    conforms(users, "/users", "post", other);
    expect(
      fx.db.raw
        .prepare("SELECT count(*) c FROM \"user\" WHERE email = 'different@example.org'")
        .get(),
    ).toEqual({ c: 0 });
  });

  it("produces exactly one effect for concurrent replays", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => invite(admin.token, "same-key-0001", "c@example.org")),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 201]);
    expect(
      fx.db.raw.prepare("SELECT count(*) c FROM \"user\" WHERE email = 'c@example.org'").get(),
    ).toEqual({ c: 1 });
  });

  it("scopes keys per caller", async () => {
    const a = await fx.makeUser("a@example.org", ["administrator"]);
    const b = await fx.makeUser("b@example.org", ["administrator"]);
    expect((await invite(a.token, "shared-key-01", "one@example.org")).statusCode).toBe(201);
    expect((await invite(b.token, "shared-key-01", "two@example.org")).statusCode).toBe(201);
  });

  it("allows reuse after the record expires", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    await invite(admin.token, "same-key-0001", "e@example.org");
    fx.db.raw.exec("UPDATE idempotency_record SET expires_at = '2000-01-01T00:00:00.000Z'");
    const again = await invite(admin.token, "same-key-0001", "f@example.org");
    expect(again.statusCode).toBe(201);
  });
});
