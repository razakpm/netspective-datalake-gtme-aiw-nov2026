import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { runIdempotent } from "../src/http/idempotency.js";
import { purgeExpiredIdempotency } from "../src/http/idempotency-purge.js";

// Retention for API idempotency records (task T080, FR-053, FR-055, SC-014).
let db: SqliteDatabase;
let clock: Date;
let runs: number;

const call = (key: string, body: unknown = { n: 1 }) =>
  runIdempotent(db, {
    actorId: "actor-1",
    route: "POST /thing",
    key,
    body,
    successStatus: 201,
    now: () => clock,
    handler: () => {
      runs += 1;
      return { ran: runs };
    },
  });

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  clock = new Date("2026-11-13T00:00:00.000Z");
  runs = 0;
});

describe("idempotency record purge", () => {
  it("removes expired records, keeps unexpired ones, and writes an audit event with counts only", () => {
    call("key-expired-1");
    clock = new Date(clock.getTime() + 23 * 3_600_000);
    call("key-fresh-0001");
    clock = new Date(clock.getTime() + 2 * 3_600_000); // first is 25 h old, second 2 h

    expect(purgeExpiredIdempotency(db, { now: () => clock })).toEqual({ purged: 1 });
    const keys = db.raw.prepare("SELECT idempotency_key FROM idempotency_record").all();
    expect(keys).toEqual([{ idempotency_key: "key-fresh-0001" }]);
    const event = db.raw
      .prepare(
        "SELECT after_summary, actor_type FROM audit_event WHERE action = 'idempotency.purged'",
      )
      .get() as { after_summary: string; actor_type: string };
    expect(JSON.parse(event.after_summary)).toEqual({ count: 1 });
    expect(event.actor_type).toBe("system");
  });

  it("lets a removed key execute the operation again", () => {
    const first = call("reused-key-01");
    clock = new Date(clock.getTime() + 25 * 3_600_000);
    purgeExpiredIdempotency(db, { now: () => clock });
    const second = call("reused-key-01");
    expect(second.status).toBe(201); // executed again, not replayed
    expect(second.body).not.toEqual(first.body);
    expect(runs).toBe(2);
  });

  it("writes an event even when nothing expired, and never removes unexpired rows", () => {
    call("fresh-key-001");
    expect(purgeExpiredIdempotency(db, { now: () => clock })).toEqual({ purged: 0 });
    expect(db.raw.prepare("SELECT count(*) c FROM idempotency_record").get()).toEqual({ c: 1 });
    expect(
      db.raw
        .prepare("SELECT count(*) c FROM audit_event WHERE action = 'idempotency.purged'")
        .get(),
    ).toEqual({ c: 1 });
  });
});
