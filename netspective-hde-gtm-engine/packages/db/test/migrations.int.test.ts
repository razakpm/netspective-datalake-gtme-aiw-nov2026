import { cpSync, mkdtempSync, appendFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  migrate,
  MigrationError,
  seedReference,
  SQLITE_MIGRATIONS_DIR,
  SqliteDatabase,
} from "../src/index.js";

// Interim SQLite run of T010 (ADR-015). The Postgres/Testcontainers version of this test remains open.
const dirs: string[] = [];
function copyOfMigrations(): string {
  const dir = mkdtempSync(join(tmpdir(), "gtm-mig-"));
  dirs.push(dir);
  cpSync(SQLITE_MIGRATIONS_DIR, dir, { recursive: true });
  return dir;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("migrations", () => {
  it("applies all migrations to an empty database, once", () => {
    const db = new SqliteDatabase();
    expect(migrate(db)).toEqual([
      "0001_foundation.sql",
      "0002_identity.sql",
      "0003_api_idempotency.sql",
      "0004_audit_hardening.sql",
      "0005_quarantine.sql",
      "0006_job.sql",
      "0007_accounts.sql",
      "0008_contacts.sql",
      "0009_icp.sql",
      "0010_suppression_review_imports.sql",
      "0011_signal_taxonomy.sql",
      "0012_signals.sql",
      "0013_signal_review.sql",
      "0014_ai_gateway.sql",
      "0015_research.sql",
      "0016_hypotheses.sql",
      "0017_claims.sql",
      "0018_offers.sql",
      "0019_capabilities.sql",
      "0020_routing.sql",
      "0021_engagement.sql",
      "0022_intake.sql",
      "0023_workshops.sql",
      "0024_workshop_findings.sql",
    ]);
    expect(migrate(db)).toEqual([]);
    const tables = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((r) => r.name);
    expect(tables).toEqual(
      expect.arrayContaining(["audit_event", "outbox_event", "phi_guard_decision"]),
    );
  });

  it("fails when an applied migration is edited", () => {
    const dir = copyOfMigrations();
    const db = new SqliteDatabase();
    migrate(db, dir);
    appendFileSync(join(dir, "0001_foundation.sql"), "\n-- edited\n");
    expect(() => migrate(db, dir)).toThrow(MigrationError);
  });

  it("fails when an applied migration is removed", () => {
    const dir = copyOfMigrations();
    const db = new SqliteDatabase();
    migrate(db, dir);
    rmSync(join(dir, "0001_foundation.sql"));
    expect(() => migrate(db, dir)).toThrow(/missing/);
  });

  it("refuses down migrations", () => {
    const dir = copyOfMigrations();
    writeFileSync(join(dir, "0002_x.down.sql"), "DROP TABLE audit_event;");
    expect(() => migrate(new SqliteDatabase(), dir)).toThrow(/down migrations/);
  });

  it("makes audit_event append-only at the database level", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.raw
      .prepare(
        "INSERT INTO audit_event (id, occurred_at, actor_type, action, entity_type, outcome, row_hash) VALUES ('a','t','system','x','y','success','h')",
      )
      .run();
    expect(() => db.raw.exec("UPDATE audit_event SET action='z'")).toThrow(/append-only/);
    expect(() => db.raw.exec("DELETE FROM audit_event")).toThrow(/append-only/);
  });
});

describe("reference seed", () => {
  it("is idempotent and matches the foundation matrix", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.transaction((tx) => seedReference(tx));
    const snapshot = () =>
      JSON.stringify([
        db.raw.prepare("SELECT key FROM role ORDER BY key").all(),
        db.raw.prepare("SELECT key FROM permission ORDER BY key").all(),
        db.raw.prepare("SELECT role_id, permission_key FROM role_permission ORDER BY 1, 2").all(),
      ]);
    const first = snapshot();
    db.transaction((tx) => seedReference(tx));
    expect(snapshot()).toBe(first);

    const matrix = db.raw
      .prepare(
        "SELECT role_id, group_concat(permission_key) perms FROM (SELECT * FROM role_permission ORDER BY permission_key) GROUP BY role_id",
      )
      .all() as { role_id: string; perms: string }[];
    const byRole = Object.fromEntries(matrix.map((r) => [r.role_id, r.perms.split(",")]));
    expect(byRole["gtm_operator"]).toEqual(
      [
        "jobs.read",
        "webhooks.read",
        "accounts.read",
        "accounts.import",
        "accounts.edit",
        "contacts.read",
        "contacts.import",
        "contacts.edit",
        "review.decide",
        "stakeholders.edit",
        "evidence.record",
        "icp.read",
        "icp.assess",
        "signals.read",
        "signals.record",
        "research.read",
        "research.run",
        "hypotheses.read",
        "hypotheses.edit",
        "capabilities.read",
        "offers.read",
        "claims.read",
        "claims.draft",
        "offers.recommend",
        "requests.read",
        "requests.review",
        "waitlist.edit",
        "workshops.edit",
        "workshops.read",
      ].sort(),
    );
    expect(byRole["read_only_executive"]).toEqual(
      [
        "ai_invocations.read",
        "audit.read",
        "jobs.read",
        "accounts.read",
        "contacts.read",
        "icp.read",
        "signals.read",
        "research.read",
        "hypotheses.read",
        "capabilities.read",
        "offers.read",
        "claims.read",
        "workshops.read",
      ].sort(),
    );
    expect(byRole["administrator"]).toHaveLength(57);
    expect(byRole["campaign_approver"]).toEqual(
      [
        "claims.approve",
        "claims.draft",
        "claims.phrases.manage",
        "claims.read",
        "notices.approve",
        "notices.manage",
      ].sort(),
    );
    expect(db.raw.prepare("SELECT count(*) c FROM role").get()).toEqual({ c: 7 });
  });

  it("rejects role assignments to ids that are not user rows (FR-009)", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.transaction((tx) => seedReference(tx));
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO user_role (user_id, role_id, assigned_at) VALUES ('ai-actor','administrator','t')",
        )
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });
});
