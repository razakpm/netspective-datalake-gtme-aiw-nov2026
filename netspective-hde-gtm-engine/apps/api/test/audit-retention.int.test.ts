import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dropAuditPeriod,
  dropExpiredAuditPeriods,
  recordAudit,
  RetentionRefusedError,
  verifyAuditChain,
} from "../src/modules/audit/index.js";

// Interim SQLite run of T053 (ADR-015). SQLite has no partitions, so "drop a partition" is "remove a
// whole calendar month through the privileged command". The Postgres partition assertions stay open.
let db: SqliteDatabase;

const at = (iso: string) => () => new Date(iso);
function add(iso: string, action: string) {
  db.transaction((tx) =>
    recordAudit(
      tx,
      { actorId: "u1", actorType: "human", action, entityType: "thing", outcome: "success" },
      at(iso),
    ),
  );
}
const count = (like: string) =>
  (
    db.raw.prepare("SELECT count(*) c FROM audit_event WHERE occurred_at LIKE ?").get(like) as {
      c: number;
    }
  ).c;

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  add("2018-01-10T00:00:00.000Z", "old.1");
  add("2018-01-20T00:00:00.000Z", "old.2");
  add("2018-02-05T00:00:00.000Z", "old.3");
  add("2026-10-01T00:00:00.000Z", "recent.1");
  add("2026-11-01T00:00:00.000Z", "recent.2");
});

const now = at("2026-11-13T00:00:00.000Z");

describe("audited retention by whole period (FR-012, FR-053)", () => {
  it("drops whole expired months, oldest first, and audits the drop in the current period", () => {
    const dropped = dropExpiredAuditPeriods(db, { retentionMonths: 84, now });
    expect(dropped.map((d) => [d.period, d.rowCount])).toEqual([
      ["2018-01", 2],
      ["2018-02", 1],
    ]);
    expect(count("2018-%")).toBe(0);
    expect(count("2026-%")).toBe(4); // 2 recent rows plus 2 retention events
    const events = db.raw
      .prepare(
        "SELECT action, entity_id, actor_type, occurred_at FROM audit_event WHERE action = 'audit.retention.dropped' ORDER BY rowid",
      )
      .all() as {
      entity_id: string;
      actor_type: string;
      occurred_at: string;
    }[];
    expect(events.map((e) => e.entity_id)).toEqual(["2018-01", "2018-02"]);
    expect(
      events.every((e) => e.actor_type === "system" && e.occurred_at.startsWith("2026-11")),
    ).toBe(true);
  });

  it("keeps the chain verifiable after a drop", () => {
    dropExpiredAuditPeriods(db, { retentionMonths: 84, now });
    const result = verifyAuditChain(db);
    expect(result.ok).toBe(true);
  });

  it("cannot drop a period inside the retention window", () => {
    expect(() => dropAuditPeriod(db, "2026-10", { retentionMonths: 84, now })).toThrow(
      RetentionRefusedError,
    );
    expect(count("2026-10%")).toBe(1);
  });

  it("only drops the oldest period (the chain stays contiguous)", () => {
    expect(() => dropAuditPeriod(db, "2018-02", { retentionMonths: 84, now })).toThrow(/oldest/);
    expect(count("2018-%")).toBe(3);
  });

  it("refuses retention periods shorter than the configured minimum", () => {
    expect(() =>
      dropExpiredAuditPeriods(db, { retentionMonths: 12, minimumMonths: 84, now }),
    ).toThrow(RetentionRefusedError);
    expect(count("2018-%")).toBe(3);
  });

  it("drops nothing and writes no event when nothing is expired", () => {
    const before = count("%");
    expect(dropExpiredAuditPeriods(db, { retentionMonths: 240, now })).toEqual([]);
    expect(count("%")).toBe(before);
  });

  it("still rejects ordinary deletes while the privileged command works", () => {
    expect(() => db.raw.exec("DELETE FROM audit_event WHERE occurred_at LIKE '2018-%'")).toThrow(
      /append-only/,
    );
    dropExpiredAuditPeriods(db, { retentionMonths: 84, now });
    expect(() => db.raw.exec("DELETE FROM audit_event")).toThrow(/append-only/);
  });

  it("detects a removed prefix that retention did not record", () => {
    db.raw.exec("DROP TRIGGER audit_event_no_delete");
    db.raw.exec("DELETE FROM audit_event WHERE action IN ('old.1','old.2')");
    expect(verifyAuditChain(db).ok).toBe(false);
  });
});
