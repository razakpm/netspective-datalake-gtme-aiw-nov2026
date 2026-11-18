import type { RoleKey } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Role-to-route matrix for the signals routes (task T055; hypothesis mapping, open question #38).
let fx: IdentityFixture;
let signalId: string;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-1','Acme','acme',?,?)",
    )
    .run(now, now);
  signalId = fx.signals.record(
    { userId: "seed", actorType: "human", correlationId: null },
    {
      accountId: "acc-1",
      typeKey: "program_announcement",
      source: { sourceId: "default-source-official_publication", ref: "https://example.org/p" },
      observation: "A program was announced",
      observedAt: now,
    },
  ).signal.id;
});
afterEach(async () => {
  await fx.app.close();
});

const ROLES: RoleKey[] = [
  "gtm_operator",
  "research_analyst",
  "technical_sme_reviewer",
  "sales_service_lead",
  "campaign_approver",
  "administrator",
  "read_only_executive",
];
const ALLOWED = {
  read: [
    "gtm_operator",
    "research_analyst",
    "technical_sme_reviewer",
    "sales_service_lead",
    "administrator",
    "read_only_executive",
  ],
  record: ["gtm_operator", "research_analyst", "administrator"],
  review: ["technical_sme_reviewer", "administrator"],
  manage: ["administrator"],
} as const;

let n = 0;
async function status(
  role: RoleKey | null,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) {
  const token = role ? (await fx.makeUser(`${role}-${n++}@example.org`, [role])).token : undefined;
  const res = await fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      "idempotency-key": `rbac-key-${n++}-padding`,
    },
    payload: payload as object | undefined,
  });
  return res.statusCode;
}

describe("signals role matrix", () => {
  it("requires sign-in everywhere", async () => {
    expect(await status(null, "GET", "/signals")).toBe(401);
    expect(await status(null, "POST", `/signals/${signalId}/review`, { decision: "approve" })).toBe(
      401,
    );
  });

  it("lets only the mapped roles view, record, review and manage sources", async () => {
    for (const role of ROLES) {
      const can = (list: readonly string[]) => list.includes(role);
      expect((await status(role, "GET", "/signals")) === 200, `${role} read`).toBe(
        can(ALLOWED.read),
      );
      expect((await status(role, "GET", `/signals/${signalId}`)) === 200, `${role} detail`).toBe(
        can(ALLOWED.read),
      );
      expect(
        (await status(role, "GET", "/accounts/acc-1/signals")) === 200,
        `${role} timeline`,
      ).toBe(can(ALLOWED.read));
      expect(
        (await status(role, "POST", "/signals", { accountId: "acc-1" })) !== 403,
        `${role} record`,
      ).toBe(can(ALLOWED.record));
      expect(
        (await status(role, "POST", `/signals/${signalId}/review`, { decision: "approve" })) !==
          403,
        `${role} review`,
      ).toBe(can(ALLOWED.review));
      expect(
        (await status(role, "PATCH", `/signal-sources/default-source-third_party`, {
          excerptMaxChars: 0,
        })) !== 403,
        `${role} manage`,
      ).toBe(can(ALLOWED.manage));
    }
  });

  it("audits every refused attempt", async () => {
    const before = (
      fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
        c: number;
      }
    ).c;
    await status("read_only_executive", "POST", `/signals/${signalId}/review`, {
      decision: "approve",
    });
    await status("research_analyst", "PATCH", "/signal-sources/default-source-third_party", {
      excerptMaxChars: 0,
    });
    const after = (
      fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
        c: number;
      }
    ).c;
    expect(after - before).toBe(2);
  });

  it("does not let a non-reviewer override reliability when recording", async () => {
    const analyst = await fx.makeUser("analyst-override@example.org", ["research_analyst"]);
    const res = await fx.app.inject({
      method: "POST",
      url: "/api/v1/signals",
      headers: { authorization: `Bearer ${analyst.token}`, "idempotency-key": "override-key-0001" },
      payload: {
        accountId: "acc-1",
        typeKey: "program_announcement",
        source: { sourceId: "default-source-official_publication", ref: "https://example.org/q" },
        observation: "Another program announcement",
        observedAt: new Date().toISOString(),
        reliability: "high",
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().detail).toContain("reliability_override_not_allowed");
  });
});
