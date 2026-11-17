import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { recordAudit, verifyAuditChain } from "../src/modules/audit/index.js";

// Interim SQLite run of T052's integration half (ADR-015).
let db: SqliteDatabase;
beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  for (let i = 1; i <= 5; i++) {
    db.transaction((tx) =>
      recordAudit(tx, {
        actorId: "u1",
        actorType: "human",
        action: `a.${i}`,
        entityType: "thing",
        outcome: "success",
        after: { i },
      }),
    );
  }
});

/** Simulates a database administrator bypassing the application: drop the triggers, then edit. */
function tamper(sql: string): void {
  db.raw.exec("DROP TRIGGER audit_event_no_update; DROP TRIGGER audit_event_no_delete;");
  db.raw.exec(sql);
}

describe("audit chain verification", () => {
  it("verifies an unmodified chain", () => {
    expect(verifyAuditChain(db)).toEqual({ ok: true, count: 5 });
  });

  it("links every row to the previous one at write time", () => {
    const rows = db.raw
      .prepare("SELECT prev_hash, row_hash FROM audit_event ORDER BY rowid")
      .all() as {
      prev_hash: string | null;
      row_hash: string;
    }[];
    expect(rows[0]!.prev_hash).toBeNull();
    for (let i = 1; i < rows.length; i++) expect(rows[i]!.prev_hash).toBe(rows[i - 1]!.row_hash);
  });

  it("detects an altered row and names it", () => {
    const target = db.raw.prepare("SELECT id FROM audit_event WHERE action = 'a.3'").get() as {
      id: string;
    };
    tamper(`UPDATE audit_event SET outcome = 'failed' WHERE id = '${target.id}'`);
    expect(verifyAuditChain(db)).toEqual({ ok: false, rowId: target.id, reason: "hash_mismatch" });
  });

  it("detects a removed row", () => {
    const gone = db.raw.prepare("SELECT id FROM audit_event WHERE action = 'a.2'").get() as {
      id: string;
    };
    const after = db.raw.prepare("SELECT id FROM audit_event WHERE action = 'a.3'").get() as {
      id: string;
    };
    tamper(`DELETE FROM audit_event WHERE id = '${gone.id}'`);
    expect(verifyAuditChain(db)).toEqual({ ok: false, rowId: after.id, reason: "broken_link" });
  });

  it("detects reordering", () => {
    tamper(`UPDATE audit_event SET id = id || '-x' WHERE action IN ('a.2')`);
    expect(verifyAuditChain(db).ok).toBe(false);
  });
});
