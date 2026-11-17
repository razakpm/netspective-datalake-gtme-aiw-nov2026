import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { CANARY_PHI, CANARY_SECRET } from "../../../packages/domain/test-support/canaries.js";
import { recordAudit } from "../src/modules/audit/index.js";

// Interim SQLite run of T025 (ADR-015); the Postgres version remains open.
let db: SqliteDatabase;
beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  db.raw.exec("CREATE TABLE thing (id TEXT PRIMARY KEY, name TEXT)");
});

const rows = (sql: string) => db.raw.prepare(sql).all() as Record<string, string | null>[];
const base = { actorId: "u1", actorType: "human", entityType: "thing", entityId: "t1" } as const;

describe("audit writer", () => {
  it("commits the state change and its audit event together", () => {
    db.transaction((tx) => {
      tx.prepare("INSERT INTO thing VALUES ('t1','a')").run();
      recordAudit(tx, {
        ...base,
        action: "thing.create",
        outcome: "success",
        after: { name: "a" },
      });
    });
    expect(rows("SELECT * FROM thing")).toHaveLength(1);
    expect(rows("SELECT * FROM audit_event")).toHaveLength(1);
  });

  it("rolls the change back when the audit write fails", () => {
    expect(() =>
      db.transaction((tx) => {
        tx.prepare("INSERT INTO thing VALUES ('t1','a')").run();
        recordAudit(tx, { ...base, action: "x", outcome: "bogus" as never });
      }),
    ).toThrow();
    expect(rows("SELECT * FROM thing")).toHaveLength(0);
    expect(rows("SELECT * FROM audit_event")).toHaveLength(0);
  });

  it("rolls the audit event back when the change fails", () => {
    expect(() =>
      db.transaction((tx) => {
        recordAudit(tx, { ...base, action: "x", outcome: "success" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(rows("SELECT * FROM audit_event")).toHaveLength(0);
  });

  it("records denied attempts and the actor type", () => {
    db.transaction((tx) =>
      recordAudit(tx, { ...base, actorType: "ai", action: "thing.delete", outcome: "denied" }),
    );
    expect(rows("SELECT outcome, actor_type FROM audit_event")).toEqual([
      { outcome: "denied", actor_type: "ai" },
    ]);
  });

  it("redacts secrets and withholds PHI-like summaries", () => {
    db.transaction((tx) => {
      recordAudit(tx, {
        ...base,
        action: "a",
        outcome: "success",
        after: { name: "n", apiToken: CANARY_SECRET },
      });
      recordAudit(tx, { ...base, action: "b", outcome: "success", after: { note: CANARY_PHI } });
    });
    const all = JSON.stringify(rows("SELECT before_summary, after_summary FROM audit_event"));
    expect(all).not.toContain(CANARY_SECRET);
    expect(all).not.toContain("Canaryfield");
    expect(all).toContain("[REDACTED]");
    expect(all).toContain("withheld");
  });

  it("cannot be updated or deleted", () => {
    db.transaction((tx) => recordAudit(tx, { ...base, action: "a", outcome: "success" }));
    expect(() => db.raw.exec("DELETE FROM audit_event")).toThrow(/append-only/);
  });
});
