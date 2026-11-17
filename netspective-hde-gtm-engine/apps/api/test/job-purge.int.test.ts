import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { JobService } from "../src/modules/jobs/index.js";
import { purgeJobDetails } from "../src/modules/jobs/purge.js";

// Retention for job payloads and error details (task T079, FR-053, SC-014).
let db: SqliteDatabase;
let clock: Date;
const day = 86_400_000;

function svc() {
  return new JobService(db, {
    now: () => clock,
    random: () => 0,
    retry: { maxAttempts: 1, baseSeconds: 1, factor: 2, capSeconds: 10, jitterRatio: 0 },
  });
}
function finish(service: JobService, key: string, outcome: "ok" | "fail", payload: unknown) {
  const { job } = service.enqueue({
    queue: "q",
    idempotencyKey: key,
    payload,
    scheduledBy: "t",
    correlationId: "corr-12345",
  });
  service.claimNext();
  if (outcome === "ok") service.complete(job.id);
  else service.fail(job.id, new Error("kaboom"));
  return job.id;
}

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  clock = new Date("2026-01-01T00:00:00.000Z");
});

describe("job detail purge", () => {
  it("removes payload and error details from old terminal jobs and keeps the metadata", () => {
    const service = svc();
    const oldFailed = finish(service, "old-failed", "fail", { marker: "old-payload" });
    const oldOk = finish(service, "old-ok", "ok", { marker: "old-ok-payload" });
    clock = new Date(clock.getTime() + 100 * day);
    const recent = finish(service, "recent", "fail", { marker: "recent-payload" });
    const waiting = service.enqueue({
      queue: "q",
      idempotencyKey: "queued-old",
      payload: { marker: "queued" },
      scheduledBy: "t",
      runAt: new Date(clock.getTime() + day * 400),
    }).job.id;
    clock = new Date(clock.getTime() + 0);

    const result = purgeJobDetails(db, { olderThanDays: 90, now: () => clock });
    expect(result).toEqual({ purged: 2 });

    const row = (id: string) =>
      db.raw.prepare("SELECT * FROM job WHERE id = ?").get(id) as Record<string, unknown>;
    for (const id of [oldFailed, oldOk]) {
      expect(row(id)).toMatchObject({
        payload: null,
        last_error: null,
        queue: "q",
        correlation_id: "corr-12345",
      });
    }
    expect(row(oldFailed)).toMatchObject({
      idempotency_key: "old-failed",
      state: "failed",
      attempts: 1,
    });
    expect(row(recent)["payload"]).not.toBeNull();
    expect(row(recent)["last_error"]).not.toBeNull();
    expect(row(waiting)["payload"]).not.toBeNull(); // never touch non-terminal jobs
  });

  it("keeps the idempotency key so a purged job's key cannot be reused for different work", () => {
    const service = svc();
    finish(service, "reused", "ok", { a: 1 });
    clock = new Date(clock.getTime() + 100 * day);
    purgeJobDetails(db, { olderThanDays: 90, now: () => clock });
    const again = service.enqueue({
      queue: "q",
      idempotencyKey: "reused",
      payload: { a: 2 },
      scheduledBy: "t",
    });
    expect(again.created).toBe(false);
    expect(db.raw.prepare("SELECT count(*) c FROM job").get()).toEqual({ c: 1 });
  });

  it("writes one audit event per run with counts only", () => {
    const service = svc();
    finish(service, "a", "ok", { secretish: "payload-marker" });
    clock = new Date(clock.getTime() + 100 * day);
    purgeJobDetails(db, { olderThanDays: 90, now: () => clock });
    purgeJobDetails(db, { olderThanDays: 90, now: () => clock });
    const events = db.raw
      .prepare(
        "SELECT action, after_summary, actor_type FROM audit_event WHERE action = 'job.details.purged'",
      )
      .all() as { after_summary: string; actor_type: string }[];
    expect(events.map((e) => JSON.parse(e.after_summary))).toEqual([{ count: 1 }, { count: 0 }]);
    expect(events.every((e) => e.actor_type === "system")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("payload-marker");
  });
});
