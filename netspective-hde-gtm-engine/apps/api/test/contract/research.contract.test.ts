import type { LightMyRequestResponse } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

// Task T052: real responses are validated against specs/004-account-research-hypotheses/contracts/research.openapi.yaml.
const research = new Contract("research.openapi.yaml", "004-account-research-hypotheses");
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";

let fx: IdentityFixture;
let tokens: { analyst: string; reviewer: string; admin: string; reader: string };
let n = 0;
async function setup(scenario = "northvale") {
  fx = await buildIdentityFixture({ researchScenario: scenario });
  tokens = {
    analyst: (await fx.makeUser("analyst@example.org", ["research_analyst"])).token,
    reviewer: (await fx.makeUser("reviewer@example.org", ["technical_sme_reviewer"])).token,
    admin: (await fx.makeUser("admin@example.org", ["administrator"])).token,
    reader: (await fx.makeUser("reader@example.org", ["read_only_executive"])).token,
  };
  const now = new Date().toISOString();
  for (const [id, name, domain, type] of [
    ["acc-n", "Northvale HIE", "northvale-hie.example", "health_information_exchange"],
    ["acc-r", "Riverbend Health", "riverbend-health.example", "health_system"],
  ] as const) {
    fx.db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
      )
      .run(id, name, name.toLowerCase(), now, now);
    fx.db.raw
      .prepare(
        "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES (?,?,?,?)",
      )
      .run(`c-${id}`, id, type, now);
    fx.db.raw
      .prepare("INSERT INTO account_domain (id, account_id, domain, created_at) VALUES (?,?,?,?)")
      .run(`d-${id}`, id, domain, now);
  }
}
afterEach(async () => {
  await fx.app.close();
});
const call = (
  token: string,
  method: "GET" | "POST" | "PATCH" | "PUT",
  url: string,
  payload?: unknown,
) =>
  fx.app.inject({
    method,
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `contract-key-${++n}-padding` },
    payload: payload as object | undefined,
  });
const conforms = (path: string, method: string, res: LightMyRequestResponse) =>
  expect(
    research.check(path, method, res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);

describe("research contract", () => {
  it("manages sources, starts, reads, lists, summarises, cancels and schedules", async () => {
    await setup();
    const forbidden = await call(tokens.analyst, "POST", "/research-sources", {
      kind: "public_org_site",
      matchType: "host_suffix",
      pattern: "northvale-hie.example",
    });
    expect(forbidden.statusCode).toBe(403);
    const rule = await call(tokens.admin, "POST", "/research-sources", {
      kind: "public_org_site",
      matchType: "host_suffix",
      pattern: "northvale-hie.example",
    });
    expect(rule.statusCode).toBe(201);
    conforms("/research-sources", "post", rule);
    expect(
      (
        await call(tokens.admin, "POST", "/research-sources", {
          kind: "public_org_site",
          matchType: "host_suffix",
          pattern: "northvale-hie.example",
        })
      ).statusCode,
    ).toBe(409);
    const list = await call(tokens.reader, "GET", "/research-sources");
    conforms("/research-sources", "get", list);
    expect(list.json().webFetchEnabled).toBe(false);
    const toggled = await call(tokens.admin, "PATCH", `/research-sources/${rule.json().id}`, {
      status: "enabled",
    });
    conforms("/research-sources/{id}", "patch", toggled);

    const started = await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
      sources: [{ address: SENDERS }, { address: IG }],
      maxSources: 5,
      maxCost: "1.50",
    });
    expect(started.statusCode).toBe(202);
    conforms("/accounts/{id}/research", "post", started);
    expect(started.json()).toMatchObject({
      state: "queued",
      budget: { maxSources: 5, maxCost: "1.50" },
    });
    const conflict = await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
      sources: [{ address: IG }],
    });
    expect(conflict.statusCode).toBe(409);
    conforms("/accounts/{id}/research", "post", conflict);

    const runId = started.json().id as string;
    await fx.research.runner.execute(runId);
    const detail = await call(tokens.reader, "GET", `/research-runs/${runId}`);
    expect(detail.statusCode).toBe(200);
    conforms("/research-runs/{id}", "get", detail);
    expect(detail.json().state).toBe("completed");
    expect(detail.json().sources).toHaveLength(2);
    expect(detail.json().findings.length).toBeGreaterThan(0);
    const accountRuns = await call(tokens.reader, "GET", "/accounts/acc-n/research");
    conforms("/accounts/{id}/research", "get", accountRuns);
    const all = await call(tokens.reader, "GET", "/research-runs?state=completed");
    conforms("/research-runs", "get", all);
    expect(all.json().items).toHaveLength(1);
    const summary = await call(tokens.reader, "GET", "/accounts/acc-n/research-summary");
    conforms("/accounts/{id}/research-summary", "get", summary);
    expect(summary.json().unknowns).toHaveLength(5);
    expect(summary.json().facts).toHaveLength(2);

    const second = await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
      sources: [{ address: IG }],
    });
    const cancelled = await call(
      tokens.analyst,
      "POST",
      `/research-runs/${second.json().id}/cancel`,
    );
    expect(cancelled.statusCode).toBe(200);
    conforms("/research-runs/{id}/cancel", "post", cancelled);
    expect(
      (await call(tokens.analyst, "POST", `/research-runs/${second.json().id}/cancel`)).statusCode,
    ).toBe(409);

    const schedule = await call(tokens.analyst, "PUT", "/accounts/acc-n/research/schedule", {
      enabled: true,
      cadence: "weekly",
    });
    expect(schedule.statusCode).toBe(200);
    conforms("/accounts/{id}/research/schedule", "put", schedule);
    expect(
      (
        await call(tokens.analyst, "PUT", "/accounts/acc-n/research/schedule", {
          enabled: true,
          cadence: "daily",
        })
      ).statusCode,
    ).toBe(400);
  });
  it("answers problems for refusals, validation, unknown and forbidden", async () => {
    await setup();
    const over = await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
      sources: [{ address: SENDERS }],
      maxCost: "2.50",
    });
    expect(over.statusCode).toBe(422);
    expect(over.json().detail).toContain("max_cost_above_run_cap");
    conforms("/accounts/{id}/research", "post", over);
    const phi = await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
      sources: [{ address: SENDERS, capturedText: "Patient SSN 000-12-3456 on file" }],
    });
    expect(phi.statusCode).toBe(422);
    expect(phi.body).not.toContain("000-12-3456");
    const bad = await call(tokens.analyst, "POST", "/accounts/acc-n/research", { maxSources: 0 });
    expect(bad.statusCode).toBe(400);
    conforms("/accounts/{id}/research", "post", bad);
    const missing = await call(tokens.analyst, "POST", "/accounts/nope/research", {
      sources: [{ address: SENDERS }],
    });
    expect(missing.statusCode).toBe(404);
    conforms("/accounts/{id}/research", "post", missing);
    expect(
      (
        await call(tokens.reader, "POST", "/accounts/acc-n/research", {
          sources: [{ address: SENDERS }],
        })
      ).statusCode,
    ).toBe(403);
    expect((await call(tokens.reader, "GET", "/research-runs/nope")).statusCode).toBe(404);
  });
  it("replays an idempotent start with the original run", async () => {
    await setup();
    const key = "same-key-for-replay-0001";
    const send = () =>
      fx.app.inject({
        method: "POST",
        url: "/api/v1/accounts/acc-n/research",
        headers: { authorization: `Bearer ${tokens.analyst}`, "idempotency-key": key },
        payload: { sources: [{ address: SENDERS }] },
      });
    const first = await send();
    const again = await send();
    expect(first.statusCode).toBe(202);
    expect(again.statusCode).toBe(202);
    expect(again.json().id).toBe(first.json().id);
    expect(
      (fx.db.raw.prepare("SELECT count(*) c FROM research_run").get() as { c: number }).c,
    ).toBe(1);
  });
  it("acknowledges a run that needs attention", async () => {
    await setup("faulty-invalid-json");
    await call(tokens.admin, "POST", "/research-sources", {
      kind: "public_org_site",
      matchType: "host_suffix",
      pattern: "northvale-hie.example",
    });
    const run = (
      await call(tokens.analyst, "POST", "/accounts/acc-n/research", {
        sources: [{ address: SENDERS }],
      })
    ).json();
    await fx.research.runner.execute(run.id);
    const queue = await call(tokens.reviewer, "GET", "/research-runs?state=needs_attention");
    expect(queue.statusCode).toBe(200);
    expect(queue.json().items.map((r: { id: string }) => r.id)).toEqual([run.id]);
    const ack = await call(tokens.reviewer, "POST", `/research-runs/${run.id}/acknowledge`, {
      note: "Looked at it; the model keeps returning invalid output.",
    });
    expect(ack.statusCode).toBe(200);
    conforms("/research-runs/{id}/acknowledge", "post", ack);
    expect(
      (
        await call(tokens.reviewer, "POST", `/research-runs/${run.id}/acknowledge`, {
          note: "once more please",
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(tokens.reader, "POST", `/research-runs/${run.id}/acknowledge`, {
          note: "not allowed here",
        })
      ).statusCode,
    ).toBe(403);
  });
  it("interprets a problem statement and refuses a PHI-like one", async () => {
    await setup("riverbend");
    const ok = await call(tokens.analyst, "POST", "/accounts/acc-r/problem-interpretations", {
      statement: "Our pilot worked on demo data but failed on ours, and we cannot tell why.",
    });
    expect(ok.statusCode).toBe(201);
    conforms("/accounts/{id}/problem-interpretations", "post", ok);
    expect(ok.json().discoveryQuestions).toHaveLength(10);
    const phi = await call(tokens.analyst, "POST", "/accounts/acc-r/problem-interpretations", {
      statement: "Patient SSN 000-12-3456 shows up in the failed pilot runs.",
    });
    expect(phi.statusCode).toBe(422);
    conforms("/accounts/{id}/problem-interpretations", "post", phi);
    expect(
      (
        await call(tokens.reader, "POST", "/accounts/acc-r/problem-interpretations", {
          statement: "Our pilot worked on demo data but failed on ours.",
        })
      ).statusCode,
    ).toBe(403);
  });
});
