import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bootstrapAdministrator, BootstrapRefusedError } from "../src/cli/admin-bootstrap.js";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Interim SQLite run of T036 and the T046 cases (ADR-015). SQLite serialises writers, so the lock
// semantics are weaker than Postgres row locks; the Postgres version must be re-run (T036).
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const h = (token: string, key?: string) => ({
  authorization: `Bearer ${token}`,
  ...(key ? { "idempotency-key": key } : {}),
});
const adminCount = () =>
  (
    fx.db.raw
      .prepare(
        `SELECT count(*) c FROM "user" u JOIN user_role r ON r.user_id = u.id
         WHERE u.status = 'active' AND r.role_id = 'administrator'`,
      )
      .get() as { c: number }
  ).c;

describe("last administrator", () => {
  it("lets exactly one of two concurrent mutual deactivations succeed", async () => {
    const a = await fx.makeUser("a@example.org", ["administrator"]);
    const b = await fx.makeUser("b@example.org", ["administrator"]);
    const [x, y] = await Promise.all([
      fx.app.inject({
        method: "POST",
        url: `/api/v1/users/${b.id}/deactivate`,
        headers: h(a.token, "key-a-deact-1"),
      }),
      fx.app.inject({
        method: "POST",
        url: `/api/v1/users/${a.id}/deactivate`,
        headers: h(b.token, "key-b-deact-1"),
      }),
    ]);
    expect([x.statusCode, y.statusCode].filter((s) => s === 200)).toHaveLength(1);
    expect(adminCount()).toBe(1);
  });

  it("refuses to deactivate the only administrator, even themselves", async () => {
    const a = await fx.makeUser("a@example.org", ["administrator"]);
    const res = await fx.app.inject({
      method: "POST",
      url: `/api/v1/users/${a.id}/deactivate`,
      headers: h(a.token, "key-self-0001"),
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().type).toBe("urn:gtm:problem:last-administrator");
    expect(adminCount()).toBe(1);
  });

  it("refuses to remove the administrator role from the only administrator", async () => {
    const a = await fx.makeUser("a@example.org", ["administrator"]);
    const res = await fx.app.inject({
      method: "PUT",
      url: `/api/v1/users/${a.id}/roles`,
      headers: h(a.token, "key-role-0001"),
      payload: { roles: ["gtm_operator"] },
    });
    expect(res.statusCode).toBe(409);
    expect(adminCount()).toBe(1);
  });

  it("allows removing an administrator while another remains", async () => {
    const a = await fx.makeUser("a@example.org", ["administrator"]);
    const b = await fx.makeUser("b@example.org", ["administrator"]);
    const res = await fx.app.inject({
      method: "PUT",
      url: `/api/v1/users/${b.id}/roles`,
      headers: h(a.token, "key-role-0001"),
      payload: { roles: [] },
    });
    expect(res.statusCode).toBe(200);
    expect(adminCount()).toBe(1);
  });
});

describe("changes take effect on the next request (US1 scenario 5)", () => {
  it("does not honour a role removed in the previous request", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const op = await fx.makeUser("op@example.org", ["administrator", "gtm_operator"]);
    const before = await fx.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: h(op.token),
    });
    expect(before.statusCode).toBe(200);
    const change = await fx.app.inject({
      method: "PUT",
      url: `/api/v1/users/${op.id}/roles`,
      headers: h(admin.token, "key-role-0001"),
      payload: { roles: ["gtm_operator"] },
    });
    expect(change.statusCode).toBe(200);
    const after = await fx.app.inject({
      method: "GET",
      url: "/api/v1/users",
      headers: h(op.token),
    });
    expect(after.statusCode).toBe(403);
  });

  it("refuses a deactivated user on their very next request", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const u = await fx.makeUser("u@example.org", ["gtm_operator"]);
    expect(
      (await fx.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: h(u.token) }))
        .statusCode,
    ).toBe(200);
    await fx.app.inject({
      method: "POST",
      url: `/api/v1/users/${u.id}/deactivate`,
      headers: h(admin.token, "key-deact-001"),
    });
    expect(
      (await fx.app.inject({ method: "GET", url: "/api/v1/auth/me", headers: h(u.token) }))
        .statusCode,
    ).toBe(403);
  });
});

describe("humans only (FR-009)", () => {
  it("fails on the foreign key when a role goes to an id that is not a user row", () => {
    expect(() =>
      fx.db.raw
        .prepare(
          "INSERT INTO user_role (user_id, role_id, assigned_at) VALUES ('ai-agent-1','administrator','t')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("bootstrap administrator (T046)", () => {
  it("creates the first administrator, audited as system, then refuses a second run", async () => {
    const fresh = await buildIdentityFixture();
    try {
      const { userId } = bootstrapAdministrator(fresh.db, "First.Admin@example.org");
      const audit = fresh.db.raw
        .prepare(
          "SELECT actor_type, action, entity_id FROM audit_event WHERE action = 'admin.bootstrap'",
        )
        .all();
      expect(audit).toEqual([
        { actor_type: "system", action: "admin.bootstrap", entity_id: userId },
      ]);
      expect(() => bootstrapAdministrator(fresh.db, "second@example.org")).toThrow(
        BootstrapRefusedError,
      );

      // The bootstrapped administrator signs in and becomes an active administrator.
      const token = await fresh.tokenFor("idp|first", "first.admin@example.org");
      const me = await fresh.app.inject({
        method: "GET",
        url: "/api/v1/auth/me",
        headers: h(token),
      });
      expect(me.json()).toMatchObject({ status: "active", roles: ["administrator"] });
    } finally {
      await fresh.app.close();
    }
  });

  it("refuses when an active administrator exists", async () => {
    await fx.makeUser("admin@example.org", ["administrator"]);
    expect(() => bootstrapAdministrator(fx.db, "other@example.org")).toThrow(BootstrapRefusedError);
  });
});
