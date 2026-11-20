import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T067 (quickstart V28) over HTTP: every route of the three contracts needs a session, and a signed-in
// caller without the permission is refused with 403 and an audited refusal (changes are covered route by
// route in audit-coverage.int.test.ts).
let fx: IdentityFixture;
beforeEach(async () => {
  fx = await buildIdentityFixture();
});
afterEach(async () => {
  await fx.app.close();
});

const PREFIXES = [
  "/api/v1/claims",
  "/api/v1/restricted-phrases",
  "/api/v1/offers",
  "/api/v1/offer-scores",
  "/api/v1/paid-engagement-types",
  "/api/v1/service-capabilities",
];
const catalogueRoutes = () =>
  fx.routes.filter(
    (r) => PREFIXES.some((p) => r.url.startsWith(p)) && !["HEAD", "OPTIONS"].includes(r.method),
  );
const concrete = (url: string) =>
  url
    .replace(":id", "x1")
    .replace(":evidenceId", "x2")
    .replace(":versionNo", "1")
    .replace(":limitationId", "x3")
    .replace(":bookingId", "x4")
    .replace(":key", "input_audit")
    .replace(":deliverableId", "x5")
    .replace(":offerId", "offer-1");

describe("authentication", () => {
  it("refuses every catalogue route without a session", async () => {
    const routes = catalogueRoutes();
    expect(routes.length).toBe(37);
    for (const r of routes) {
      const res = await fx.app.inject({
        method: r.method as "GET",
        url: concrete(r.url),
        headers: { "idempotency-key": "no-session-key-0001" },
        payload: r.method === "GET" || r.method === "DELETE" ? undefined : {},
      });
      expect(res.statusCode, `${r.method} ${r.url}`).toBe(401);
    }
  });
});

describe("a signed-in caller without any role", () => {
  it("is refused with 403 and an audited refusal on every read route", async () => {
    const nobody = await fx.makeUser("nobody@example.org");
    const reads = catalogueRoutes().filter((r) => r.method === "GET");
    expect(reads.length).toBeGreaterThanOrEqual(13);
    for (const r of reads) {
      const before = (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c;
      const res = await fx.app.inject({
        method: "GET",
        url: concrete(r.url),
        headers: { authorization: `Bearer ${nobody.token}` },
      });
      expect(res.statusCode, r.url).toBe(403);
      const after = (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c;
      expect(after - before, r.url).toBe(1);
    }
  });
});

describe("restricted approvals", () => {
  it("are refused to roles that do not hold them, whoever asks", async () => {
    const analyst = await fx.makeUser("analyst@example.org", ["research_analyst"]);
    const marketing = await fx.makeUser("marketing@example.org", ["campaign_approver"]);
    const claim = fx.catalogue.claims.draft(
      {
        userId: analyst.id,
        actorType: "human",
        correlationId: null,
        permissions: ["claims.draft"],
      },
      { text: "We review sender feeds weekly." },
    );
    const approve = (token: string) =>
      fx.app.inject({
        method: "POST",
        url: `/api/v1/claims/${claim.id}/review`,
        headers: {
          authorization: `Bearer ${token}`,
          "idempotency-key": `approve-${token.length}-key-0001`,
        },
        payload: { decision: "approve", note: "Checked it" },
      });
    expect((await approve(analyst.token)).statusCode).toBe(403);
    expect((await approve(marketing.token)).statusCode).toBe(409);
    const decide = await fx.app.inject({
      method: "POST",
      url: "/api/v1/paid-engagement-types/input_audit/deliverables/none/decision",
      headers: {
        authorization: `Bearer ${marketing.token}`,
        "idempotency-key": "decide-key-0001-aaa",
      },
      payload: { decision: "approve", note: "Agreed" },
    });
    expect(decide.statusCode).toBe(403);
  });
});
