import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// SC-002 and FR-010/011 across ALL routes (task T055). The route list comes from Fastify's registry, so
// a state-changing route added without an entry in DRIVERS fails this test.

let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

let seq = 0;
const target = (fx: IdentityFixture) =>
  fx.makeUser(`target${seq++}@example.org`, ["gtm_operator"]).then((u) => u.id);

interface Call {
  url: string;
  payload?: unknown;
  contentType?: string;
  /** Role used for the forbidden attempt when gtm_operator is itself allowed on the route. */
  forbiddenRole?: "read_only_executive";
}

const DRIVERS: Record<string, (fx: IdentityFixture) => Promise<Call>> = {
  "POST /api/v1/users": async () => ({
    url: "/api/v1/users",
    payload: { email: "invited@example.org" },
  }),
  "PUT /api/v1/users/:userId/roles": async (f) => ({
    url: `/api/v1/users/${await target(f)}/roles`,
    payload: { roles: ["research_analyst"] },
  }),
  "POST /api/v1/users/:userId/deactivate": async (f) => ({
    url: `/api/v1/users/${await target(f)}/deactivate`,
  }),
  "POST /api/v1/users/:userId/reactivate": async (f) => {
    const id = await target(f);
    f.db.raw.prepare("UPDATE \"user\" SET status = 'deactivated' WHERE id = ?").run(id);
    return { url: `/api/v1/users/${id}/reactivate` };
  },
};

const held = (f: IdentityFixture) =>
  f.db.transaction((tx) =>
    f.quarantine.hold(tx, {
      entryPoint: "api_body",
      content: "synthetic held content",
      ruleIds: ["PHI.SSN"],
      guardVersion: "test",
    }),
  );
DRIVERS["POST /api/v1/quarantine-items/:id/content"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/content`,
  payload: { purpose: "coverage check" },
});
DRIVERS["POST /api/v1/quarantine-items/:id/release"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/release`,
  payload: { reason: "coverage check" },
});
DRIVERS["POST /api/v1/quarantine-items/:id/discard"] = async (f) => ({
  url: `/api/v1/quarantine-items/${held(f)}/discard`,
  payload: { reason: "coverage check" },
});

let accountSeq = 0;
function makeAccount(f: IdentityFixture): string {
  const id = `acct-${accountSeq++}`;
  const now = new Date().toISOString();
  f.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
    )
    .run(id, `Coverage ${id}`, `coverage ${id}`, now, now);
  f.db.raw
    .prepare(
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
    )
    .run(`cls-${id}`, id, "health_system", now);
  f.db.raw
    .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
    .run(`dom-${id}`, id, `${id}.example`, now);
  return id;
}

// Feature 002 routes. gtm_operator may use these, so the forbidden attempt uses a read-only role.
DRIVERS["POST /api/v1/accounts/import"] = async () => ({
  // A single invalid row: no account events, so the run summary is the one audit event.
  url: "/api/v1/accounts/import",
  contentType: "text/csv",
  payload: "name,type\n,health_system\n",
  forbiddenRole: "read_only_executive",
});
DRIVERS["PATCH /api/v1/accounts/:id"] = async (f) => ({
  url: `/api/v1/accounts/${makeAccount(f)}`,
  payload: { geography: "Coverage region" },
  forbiddenRole: "read_only_executive",
});
DRIVERS["PUT /api/v1/accounts/:id/domains/:domain/shared"] = async (f) => {
  const id = makeAccount(f);
  return {
    url: `/api/v1/accounts/${id}/domains/${id}.example/shared`,
    payload: { shared: true },
    forbiddenRole: "read_only_executive",
  };
};
DRIVERS["POST /api/v1/review-items/:id/decision"] = async (f) => {
  const a = makeAccount(f);
  const b = makeAccount(f);
  const id = `review-${a}`;
  f.db.raw
    .prepare(
      `INSERT INTO review_item (id, kind, subject_a, subject_b, reason_codes, pair_key,
         attribute_fingerprint, state, proposed_at) VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .run(id, "merge_candidate", a, b, "[]", `${a}:${b}`, "fp", "open", new Date().toISOString());
  return {
    url: `/api/v1/review-items/${id}/decision`,
    payload: { decision: "reject", reason: "coverage check" },
    forbiddenRole: "read_only_executive",
  };
};

/** Routes that cannot be driven through the fake issuer (none yet; webhook ingress arrives with US5). */
const EXEMPT: Record<string, string> = {};

const REQUIRED = [
  "id",
  "occurred_at",
  "actor_type",
  "action",
  "entity_type",
  "outcome",
  "correlation_id",
  "row_hash",
];

function stateChangingRoutes(f: IdentityFixture): string[] {
  return f.routes
    .filter((r) => !["GET", "HEAD", "OPTIONS"].includes(r.method))
    .map((r) => `${r.method} ${r.url}`);
}

describe("audit coverage of every state-changing route", () => {
  it("has a driver (or an explicit exemption) for every non-GET route", () => {
    const missing = stateChangingRoutes(fx).filter((r) => !(r in DRIVERS) && !(r in EXEMPT));
    expect(missing, `routes without audit coverage: ${missing.join(", ")}`).toEqual([]);
  });

  it("writes exactly one complete event per successful call, and one denied event per forbidden call", async () => {
    const admin = await fx.makeUser("admin@example.org", ["administrator"]);
    const operator = await fx.makeUser("operator@example.org", ["gtm_operator"]);
    const reader = await fx.makeUser("reader@example.org", ["read_only_executive"]);
    const method = (route: string) => route.split(" ")[0] as "POST" | "PUT" | "PATCH";

    for (const route of stateChangingRoutes(fx).filter((r) => r in DRIVERS)) {
      const call = await DRIVERS[route]!(fx);

      // forbidden
      const deniedBefore = count("outcome = 'denied'");
      const total = count("1=1");
      const forbidden = await fx.app.inject({
        method: method(route),
        url: call.url,
        headers: {
          authorization: `Bearer ${call.forbiddenRole ? reader.token : operator.token}`,
          "idempotency-key": `deny-${route.length}-aaaa`,
          ...(call.contentType ? { "content-type": call.contentType } : {}),
        },
        payload: call.payload ?? {},
      });
      expect(forbidden.statusCode, route).toBe(403);
      expect(count("outcome = 'denied'") - deniedBefore, route).toBe(1);
      expect(count("1=1") - total, route).toBe(1);

      // successful
      const before = count("outcome = 'success'");
      const ok = await fx.app.inject({
        method: method(route),
        url: call.url,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "idempotency-key": `ok-${route.length}-bbbbbb`,
          "x-correlation-id": "coverage-corr-01",
          ...(call.contentType ? { "content-type": call.contentType } : {}),
        },
        payload: call.payload ?? {},
      });
      expect([200, 201, 204], route).toContain(ok.statusCode);
      expect(count("outcome = 'success'") - before, route).toBe(1);
      const last = fx.db.raw
        .prepare("SELECT * FROM audit_event WHERE outcome = 'success' ORDER BY rowid DESC LIMIT 1")
        .get() as Record<string, unknown>;
      for (const field of REQUIRED) expect(last[field], `${route} ${field}`).toBeTruthy();
      expect(last["actor_id"]).toBe(admin.id);
    }
  });

  function count(where: string): number {
    return (
      fx.db.raw.prepare(`SELECT count(*) c FROM audit_event WHERE ${where}`).get() as { c: number }
    ).c;
  }
});
