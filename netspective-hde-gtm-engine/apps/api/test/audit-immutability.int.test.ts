import { migrate, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { AuditTamperError, recordAudit, runAuditMutation } from "../src/modules/audit/index.js";

// Interim SQLite run of T051 (ADR-015): enforcement is by triggers, not by database privileges.
let db: SqliteDatabase;
let rowId: string;
beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  rowId = db.transaction((tx) =>
    recordAudit(tx, {
      actorId: "u1",
      actorType: "human",
      action: "thing.create",
      entityType: "thing",
      outcome: "success",
    }),
  );
});

const events = () =>
  db.raw
    .prepare("SELECT id, action, outcome, actor_id, after_summary FROM audit_event ORDER BY rowid")
    .all() as {
    id: string;
    action: string;
    outcome: string;
    actor_id: string | null;
    after_summary: string | null;
  }[];

describe("audit events are append-only (FR-012)", () => {
  it("rejects UPDATE and DELETE, including for a single row", () => {
    expect(() =>
      db.raw.prepare("UPDATE audit_event SET action = 'x' WHERE id = ?").run(rowId),
    ).toThrow(/append-only/);
    expect(() => db.raw.prepare("DELETE FROM audit_event WHERE id = ?").run(rowId)).toThrow(
      /append-only/,
    );
    expect(() => db.raw.exec("DELETE FROM audit_event")).toThrow(/append-only/);
  });

  it("rejects inserts that carry no chain hash", () => {
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO audit_event (id, occurred_at, actor_type, action, entity_type, outcome) VALUES ('x','t','system','a','b','success')",
        )
        .run(),
    ).toThrow(/row_hash/);
  });

  it("records a refused modification as a separate audit event in a new transaction", () => {
    expect(() =>
      runAuditMutation(db, { kind: "update", actorId: "u1", correlationId: "corr-12345" }, (tx) =>
        tx.prepare("UPDATE audit_event SET action = 'forged' WHERE id = ?").run(rowId),
      ),
    ).toThrow(AuditTamperError);

    const rows = events();
    expect(rows).toHaveLength(2);
    expect(rows[0]!.action).toBe("thing.create"); // unchanged
    expect(rows[1]).toMatchObject({
      action: "audit.tamper.attempted",
      outcome: "denied",
      actor_id: "u1",
    });
  });

  it("records a refused deletion too, and never stores the attempted content", () => {
    expect(() =>
      runAuditMutation(db, { kind: "delete", actorId: null, correlationId: null }, (tx) =>
        tx.prepare("DELETE FROM audit_event WHERE id = ?").run(rowId),
      ),
    ).toThrow(AuditTamperError);
    const last = events().at(-1)!;
    expect(last.action).toBe("audit.tamper.attempted");
    expect(last.after_summary).toBe(JSON.stringify({ kind: "delete" }));
    expect(last.after_summary).not.toContain(rowId);
  });

  it("rolls back the failed statement's transaction (nothing else it did survives)", () => {
    db.raw.exec("CREATE TABLE side (x TEXT)");
    expect(() =>
      runAuditMutation(db, { kind: "delete", actorId: null, correlationId: null }, (tx) => {
        tx.exec("INSERT INTO side VALUES ('should-vanish')");
        tx.exec("DELETE FROM audit_event");
      }),
    ).toThrow(AuditTamperError);
    expect(db.raw.prepare("SELECT count(*) c FROM side").get()).toEqual({ c: 0 });
  });

  it("lets unrelated errors through untouched, without a tamper event", () => {
    expect(() =>
      runAuditMutation(db, { kind: "update", actorId: null, correlationId: null }, () => {
        throw new Error("unrelated");
      }),
    ).toThrow("unrelated");
    expect(events()).toHaveLength(1);
  });
});
