import type { RoleKey } from "@gtm/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildIdentityFixture, type IdentityFixture } from "../test-support/identity-fixture.js";

// Task T056: the role matrix across the research and hypothesis routes (hypothesis mapping, open question #46).
let fx: IdentityFixture;
let hypothesisId: string;
beforeEach(async () => {
  fx = await buildIdentityFixture();
  const now = new Date().toISOString();
  fx.db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-1','Acme','acme',?,?)",
    )
    .run(now, now);
  fx.db.raw
    .prepare(
      "INSERT INTO account_domain (id, account_id, domain, created_at) VALUES ('d1','acc-1','acme.example',?)",
    )
    .run(now);
  const signal = fx.signals.record(
    { userId: "seed", actorType: "human", correlationId: null },
    {
      accountId: "acc-1",
      typeKey: "onboarding_delay",
      source: { sourceId: "default-source-official_publication", ref: "https://example.org/s" },
      observation: "Senders report onboarding delays.",
      observedAt: now,
    },
  ).signal;
  hypothesisId = fx.research.hypotheses.create(
    { userId: "seed", actorType: "human", correlationId: null },
    "acc-1",
    {
      statement: "Sender onboarding delays may be slowing intake.",
      category: "onboarding_friction",
      supportingSignalIds: [signal.id],
      confidence: { band: "low", explanation: "Early evidence only." },
    },
  ).id;
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
  run: ["gtm_operator", "research_analyst", "administrator"],
  manage: ["administrator"],
  edit: ["gtm_operator", "research_analyst", "administrator"],
  review: ["technical_sme_reviewer", "administrator"],
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
const permitted = (code: number) => code !== 403 && code !== 401;

describe("research and hypothesis role matrix", () => {
  it("requires sign-in everywhere", async () => {
    expect(await status(null, "GET", "/research-runs")).toBe(401);
    expect(await status(null, "POST", "/accounts/acc-1/research", {})).toBe(401);
    expect(
      await status(null, "PATCH", `/hypotheses/${hypothesisId}`, {
        status: "strengthening",
        note: "x y z",
      }),
    ).toBe(401);
  });
  it("lets only the mapped roles read, run research, manage sources, edit and review", async () => {
    for (const role of ROLES) {
      const can = (list: readonly string[]) => list.includes(role);
      expect(permitted(await status(role, "GET", "/research-runs")), `${role} read runs`).toBe(
        can(ALLOWED.read),
      );
      expect(
        permitted(await status(role, "GET", `/hypotheses/${hypothesisId}`)),
        `${role} read hypothesis`,
      ).toBe(can(ALLOWED.read));
      expect(
        permitted(await status(role, "GET", "/accounts/acc-1/research-summary")),
        `${role} read summary`,
      ).toBe(can(ALLOWED.read));
      expect(
        permitted(await status(role, "POST", "/accounts/acc-1/research", { maxSources: 0 })),
        `${role} start run`,
      ).toBe(can(ALLOWED.run));
      expect(
        permitted(
          await status(role, "POST", "/accounts/acc-1/problem-interpretations", {
            statement: "short",
          }),
        ),
        `${role} interpret`,
      ).toBe(can(ALLOWED.run));
      expect(
        permitted(await status(role, "POST", "/research-sources", { kind: "bad" })),
        `${role} manage sources`,
      ).toBe(can(ALLOWED.manage));
      expect(
        permitted(await status(role, "POST", "/accounts/acc-1/hypotheses", { statement: "short" })),
        `${role} create hypothesis`,
      ).toBe(can(ALLOWED.edit));
    }
  });
  it("splits a hypothesis PATCH: edits need hypotheses.edit, a status change or flag acknowledgement needs hypotheses.review", async () => {
    for (const role of ROLES) {
      const edit = await status(role, "PATCH", `/hypotheses/${hypothesisId}`, {
        statement: "Sender onboarding delays may be slowing intake in several formats.",
      });
      expect(permitted(edit), `${role} edit`).toBe(ALLOWED.edit.includes(role as never));
      const review = await status(role, "PATCH", `/hypotheses/${hypothesisId}`, {
        status: "weakening",
        note: "A newer source disagrees.",
      });
      expect(permitted(review), `${role} review`).toBe(ALLOWED.review.includes(role as never));
    }
  });
  it("lets an analyst never change a status, a reviewer never start a run, and only an administrator manage sources", async () => {
    expect(
      await status("research_analyst", "PATCH", `/hypotheses/${hypothesisId}`, {
        status: "strengthening",
        note: "an analyst tries",
      }),
    ).toBe(403);
    expect(await status("technical_sme_reviewer", "POST", "/accounts/acc-1/research", {})).toBe(
      403,
    );
    expect(
      await status("gtm_operator", "POST", "/research-sources", {
        kind: "public_org_site",
        matchType: "host",
        pattern: "x.example",
      }),
    ).toBe(403);
    expect(
      await status("administrator", "POST", "/research-sources", {
        kind: "public_org_site",
        matchType: "host",
        pattern: "acme.example",
      }),
    ).toBe(201);
  });
  it("audits every refused attempt", async () => {
    const before = () =>
      (
        fx.db.raw.prepare("SELECT count(*) c FROM audit_event WHERE outcome = 'denied'").get() as {
          c: number;
        }
      ).c;
    const start = before();
    await status("read_only_executive", "POST", "/accounts/acc-1/research", {});
    await status("research_analyst", "POST", "/research-sources", {
      kind: "public_org_site",
      matchType: "host",
      pattern: "x.example",
    });
    await status("research_analyst", "PATCH", `/hypotheses/${hypothesisId}`, {
      status: "strengthening",
      note: "an analyst tries",
    });
    expect(before() - start).toBe(3);
  });
});
