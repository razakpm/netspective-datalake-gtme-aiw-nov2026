import type { LightMyRequestResponse } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CANARY_SECRET } from "../../../../packages/domain/test-support/canaries.js";
import { Contract } from "../../test-support/openapi-contract.js";
import { buildIdentityFixture, type IdentityFixture } from "../../test-support/identity-fixture.js";

const contract = new Contract("jobs.openapi.yaml");
let fx: IdentityFixture;
let reader: { id: string; token: string };
beforeEach(async () => {
  fx = await buildIdentityFixture();
  reader = await fx.makeUser("exec@example.org", ["read_only_executive"]);
});
afterEach(async () => {
  await fx.app.close();
});

const get = (url: string, token = reader.token) =>
  fx.app.inject({
    method: "GET",
    url: `/api/v1${url}`,
    headers: { authorization: `Bearer ${token}` },
  });
const conforms = (path: string, res: LightMyRequestResponse) =>
  expect(
    contract.check(path, "get", res.statusCode, String(res.headers["content-type"]), res.json()),
  ).toEqual([]);

function failJob(key: string, message: string) {
  const { job } = fx.jobs.enqueue({
    queue: "q",
    idempotencyKey: key,
    payload: { marker: "payload-marker-xyz" },
    scheduledBy: "t",
    maxAttempts: 1,
  });
  fx.jobs.claimNext();
  fx.jobs.fail(job.id, new Error(message));
  return job.id;
}

describe("jobs admin routes", () => {
  it("refuses callers without jobs.read with 403 and a denied event", async () => {
    const op = await fx.makeUser("nobody@example.org", ["research_analyst"]);
    const res = await get("/jobs", op.token);
    expect(res.statusCode).toBe(403);
    conforms("/jobs", res);
    expect(
      fx.db.raw.prepare("SELECT action, actor_id FROM audit_event WHERE outcome = 'denied'").all(),
    ).toEqual([{ action: "jobs.read.denied", actor_id: op.id }]);
  });

  it("lists failed jobs with redacted error details and never returns payloads", async () => {
    failJob("k1", `failed with ${CANARY_SECRET}`);
    const res = await get("/jobs?state=failed");
    expect(res.statusCode).toBe(200);
    conforms("/jobs", res);
    const [item] = res.json().items;
    expect(item).toMatchObject({ state: "failed", queue: "q", lastError: { code: "Error" } });
    expect(res.body).not.toContain("payload-marker-xyz");
    expect(item.lastError.stack_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("filters by queue and state and returns one job", async () => {
    const id = failJob("k1", "boom");
    fx.jobs.enqueue({ queue: "other", idempotencyKey: "k2", payload: {}, scheduledBy: "t" });
    expect((await get("/jobs?queue=other")).json().items).toHaveLength(1);
    expect((await get("/jobs?state=queued&queue=q")).json().items).toHaveLength(0);
    const one = await get(`/jobs/${id}`);
    conforms("/jobs/{id}", one);
    expect(one.json().id).toBe(id);
    expect((await get("/jobs/does-not-exist")).statusCode).toBe(404);
  });

  it("shows queue depth with the cap", async () => {
    fx.jobs.enqueue({ queue: "q", idempotencyKey: "k1", payload: {}, scheduledBy: "t" });
    const res = await get("/jobs/queues");
    conforms("/jobs/queues", res);
    expect(res.json().items).toEqual([
      { queue: "q", queued: 1, running: 0, failed: 0, depthCap: 1000 },
    ]);
  });

  it("rejects invalid filters without echoing them", async () => {
    const res = await get("/jobs?state=exploded");
    expect(res.statusCode).toBe(400);
    expect(res.body).not.toContain("exploded");
  });
});
