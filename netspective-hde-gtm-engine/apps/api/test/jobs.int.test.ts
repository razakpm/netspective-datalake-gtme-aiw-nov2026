import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { CANARY_PHI, CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";
import { registerSecret, clearRegisteredSecrets, createLogger } from "../src/logging/logger.js";
import { JobService, tickSchedules } from "../src/modules/jobs/index.js";
import { Worker } from "../src/worker/bootstrap.js";
import { HandlerRegistry } from "../src/worker/registry.js";
import {
  alwaysFail,
  alwaysOk,
  ALWAYS_FAIL_QUEUE,
  ALWAYS_OK_QUEUE,
  registerSyntheticJobs,
} from "../test-support/jobs/index.js";

// Interim SQLite run of T074 (ADR-015); pg-boss and real worker concurrency remain for Postgres.
let db: SqliteDatabase;
let clock: Date;
const now = () => clock;
const advance = (ms: number) => {
  clock = new Date(clock.getTime() + ms);
};
const logger = createLogger({ level: "silent" });

function service(over: ConstructorParameters<typeof JobService>[1] = {}) {
  return new JobService(db, { now, random: () => 0, ...over });
}
const actions = () =>
  (
    db.raw
      .prepare("SELECT action FROM audit_event WHERE entity_type = 'job' ORDER BY rowid")
      .all() as { action: string }[]
  ).map((r) => r.action);

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  clock = new Date("2026-11-13T00:00:00.000Z");
  clearRegisteredSecrets();
});

describe("idempotent submission (FR-024)", () => {
  it("runs a duplicate key once, including concurrent submissions", async () => {
    const svc = service();
    const ran: string[] = [];
    const registry = new HandlerRegistry();
    registry.register(
      ALWAYS_OK_QUEUE,
      alwaysOk((k) => ran.push(k)),
    );

    const results = await Promise.all(
      Array.from({ length: 10 }, async () =>
        svc.enqueue({
          queue: ALWAYS_OK_QUEUE,
          idempotencyKey: "k1",
          payload: { n: 1 },
          scheduledBy: "test",
        }),
      ),
    );
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.job.id)).size).toBe(1);

    await new Worker({ service: svc, registry, logger }).runOnce();
    expect(ran).toEqual(["k1"]);
    expect(db.raw.prepare("SELECT count(*) c FROM job").get()).toEqual({ c: 1 });
  });

  it("scopes keys per queue", () => {
    const svc = service();
    const a = svc.enqueue({ queue: "a", idempotencyKey: "k", payload: {}, scheduledBy: "t" });
    const b = svc.enqueue({ queue: "b", idempotencyKey: "k", payload: {}, scheduledBy: "t" });
    expect(a.job.id).not.toBe(b.job.id);
  });
});

describe("retry then terminal failure (FR-025, FR-026)", () => {
  it("retries with growing delays, ends failed, and audits every transition", async () => {
    const svc = service({
      retry: { maxAttempts: 3, baseSeconds: 30, factor: 2, capSeconds: 3600, jitterRatio: 0 },
    });
    const registry = new HandlerRegistry();
    registerSyntheticJobs(registry);
    const worker = new Worker({ service: svc, registry, logger });
    const { job } = svc.enqueue({
      queue: ALWAYS_FAIL_QUEUE,
      idempotencyKey: "f1",
      payload: {},
      scheduledBy: "test",
    });

    await worker.runOnce();
    expect(svc.get(job.id)).toMatchObject({
      state: "queued",
      attempts: 1,
      nextRunAt: new Date(clock.getTime() + 30_000).toISOString(),
    });

    expect(await worker.runOnce()).toBe(0); // not due yet
    advance(30_000);
    await worker.runOnce();
    expect(svc.get(job.id)).toMatchObject({
      state: "queued",
      attempts: 2,
      nextRunAt: new Date(clock.getTime() + 60_000).toISOString(),
    });

    advance(60_000);
    await worker.runOnce();
    const failed = svc.get(job.id);
    expect(failed).toMatchObject({ state: "failed", attempts: 3 });
    expect(failed.lastError).toMatchObject({ code: "Error", message: "synthetic failure" });
    expect(failed.finishedAt).not.toBeNull();

    expect(actions()).toEqual([
      "job.enqueued",
      "job.started",
      "job.retry_scheduled",
      "job.started",
      "job.retry_scheduled",
      "job.started",
      "job.failed",
    ]);

    advance(10 * 3_600_000);
    expect(await worker.runOnce()).toBe(0); // terminal: never runs again
  });

  it("does not let terminal jobs change state", () => {
    const svc = service();
    const { job } = svc.enqueue({ queue: "q", idempotencyKey: "k", payload: {}, scheduledBy: "t" });
    svc.claimNext();
    svc.complete(job.id);
    expect(() =>
      db.raw.prepare("UPDATE job SET state = 'queued' WHERE id = ?").run(job.id),
    ).toThrow(/terminal/);
  });

  it("succeeds and audits a normal job", async () => {
    const svc = service();
    const registry = new HandlerRegistry();
    registerSyntheticJobs(registry);
    const { job } = svc.enqueue({
      queue: ALWAYS_OK_QUEUE,
      idempotencyKey: "ok1",
      payload: {},
      scheduledBy: "t",
    });
    await new Worker({ service: svc, registry, logger }).runOnce();
    expect(svc.get(job.id).state).toBe("succeeded");
    expect(actions()).toEqual(["job.enqueued", "job.started", "job.succeeded"]);
  });
});

describe("redacted errors (FR-026, FR-034)", () => {
  it("keeps secrets, PHI-like text and the payload out of error details and audit", async () => {
    registerSecret(CANARY_SECRET);
    const svc = service({
      retry: { maxAttempts: 1, baseSeconds: 1, factor: 2, capSeconds: 10, jitterRatio: 0 },
    });
    const registry = new HandlerRegistry();
    registry.register("q", alwaysFail(`boom ${CANARY_SECRET} then ${CANARY_PHI}`));
    const { job } = svc.enqueue({
      queue: "q",
      idempotencyKey: "r1",
      payload: { note: "payload-marker-xyz" },
      scheduledBy: "t",
    });
    await new Worker({ service: svc, registry, logger }).runOnce();

    const stored =
      JSON.stringify(db.raw.prepare("SELECT last_error FROM job").all()) +
      JSON.stringify(db.raw.prepare("SELECT * FROM audit_event").all());
    expect(stored).not.toContain(CANARY_SECRET);
    expect(stored).not.toContain("Canaryfield");
    expect(stored).not.toContain("payload-marker-xyz");
    expect(svc.get(job.id).lastError?.stack_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(svc.get(job.id))).not.toContain("payload-marker-xyz");
  });

  it("refuses a PHI-like payload at submission and stores nothing", () => {
    const svc = service();
    expect(() =>
      svc.enqueue({
        queue: "q",
        idempotencyKey: "p1",
        payload: { text: CANARY_PHI },
        scheduledBy: "t",
      }),
    ).toThrow(/cannot be stored/);
    expect(db.raw.prepare("SELECT count(*) c FROM job").get()).toEqual({ c: 0 });
  });
});

describe("back-pressure and concurrency (FR-027, SC-004)", () => {
  it("refuses submissions above the queue-depth cap with a typed error and drops nothing", () => {
    const svc = service({ queueDepthCap: 5 });
    const accepted: string[] = [];
    const refused: unknown[] = [];
    for (let i = 0; i < 20; i++) {
      try {
        accepted.push(
          svc.enqueue({ queue: "storm", idempotencyKey: `s${i}`, payload: {}, scheduledBy: "t" })
            .job.id,
        );
      } catch (error) {
        refused.push(error);
      }
    }
    expect(accepted).toHaveLength(5);
    expect(refused).toHaveLength(15);
    expect(
      refused.every(
        (e) => (e as { problemType: string }).problemType === "urn:gtm:problem:back-pressure",
      ),
    ).toBe(true);
    expect(db.raw.prepare("SELECT count(*) c FROM job").get()).toEqual({ c: 5 }); // every accepted job exists
  });

  it("counts only queued and running jobs towards the cap", () => {
    const svc = service({ queueDepthCap: 1 });
    const { job } = svc.enqueue({ queue: "q", idempotencyKey: "a", payload: {}, scheduledBy: "t" });
    svc.claimNext();
    svc.complete(job.id);
    expect(() =>
      svc.enqueue({ queue: "q", idempotencyKey: "b", payload: {}, scheduledBy: "t" }),
    ).not.toThrow();
  });

  it("never runs more jobs per queue at once than the concurrency limit", () => {
    const svc = service({ concurrency: 2 });
    for (let i = 0; i < 5; i++)
      svc.enqueue({ queue: "q", idempotencyKey: `c${i}`, payload: {}, scheduledBy: "t" });
    expect(svc.claimNext()).not.toBeNull();
    expect(svc.claimNext()).not.toBeNull();
    expect(svc.claimNext()).toBeNull();
  });
});

describe("recurring schedules (FR-028)", () => {
  it("enqueues once per occurrence even when two scheduler instances tick", () => {
    const a = service();
    const b = service();
    const schedules = [{ name: "nightly-check", queue: "q", everySeconds: 3600 }];
    const t = new Date("2026-11-13T10:15:00.000Z");
    const created =
      tickSchedules(a, schedules, t) +
      tickSchedules(b, schedules, t) +
      tickSchedules(a, schedules, new Date(t.getTime() + 60_000));
    expect(created).toBe(1);
    // next occurrence
    expect(tickSchedules(b, schedules, new Date("2026-11-13T11:00:00.000Z"))).toBe(1);
    expect(db.raw.prepare("SELECT count(*) c FROM job").get()).toEqual({ c: 2 });
  });
});

describe("worker resilience (T078)", () => {
  it("survives a crashing handler and keeps processing the next job", async () => {
    const svc = service();
    const registry = new HandlerRegistry();
    registerSyntheticJobs(registry);
    svc.enqueue({ queue: ALWAYS_FAIL_QUEUE, idempotencyKey: "x", payload: {}, scheduledBy: "t" });
    svc.enqueue({ queue: ALWAYS_OK_QUEUE, idempotencyKey: "y", payload: {}, scheduledBy: "t" });
    expect(await new Worker({ service: svc, registry, logger }).runOnce()).toBe(2);
  });

  it("does not claim jobs for queues without a handler", async () => {
    const svc = service();
    svc.enqueue({ queue: "unknown", idempotencyKey: "u", payload: {}, scheduledBy: "t" });
    const registry = new HandlerRegistry();
    registry.register(ALWAYS_OK_QUEUE, alwaysOk());
    expect(await new Worker({ service: svc, registry, logger }).runOnce()).toBe(0);
    expect(db.raw.prepare("SELECT state FROM job").get()).toEqual({ state: "queued" });
  });

  it("stops gracefully", async () => {
    const svc = service();
    const worker = new Worker({
      service: svc,
      registry: new HandlerRegistry(),
      logger,
      pollMs: 10,
    });
    worker.start();
    await worker.stop();
  });

  it("refuses to register synthetic jobs in production", () => {
    const previous = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "production";
    try {
      expect(() => registerSyntheticJobs(new HandlerRegistry())).toThrow(/production/);
    } finally {
      if (previous === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = previous;
    }
  });
});
