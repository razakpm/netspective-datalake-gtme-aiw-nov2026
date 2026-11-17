import { describe, expect, it } from "vitest";
import { migrate, SqliteDatabase } from "../src/index.js";

// Migrations 0007-0010 (feature 002): constraints and append-only triggers (tasks T006-T009).
function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  return db;
}
const now = "2026-11-17T00:00:00.000Z";
const run = (db: SqliteDatabase, sql: string, ...args: (string | number | null)[]) =>
  db.raw.prepare(sql).run(...args);

function account(db: SqliteDatabase, id = "a1") {
  run(
    db,
    "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
    id,
    "Acme",
    "acme",
    now,
    now,
  );
}
function contact(db: SqliteDatabase, id = "c1") {
  run(db, "INSERT INTO contact (id, created_at, updated_at) VALUES (?,?,?)", id, now, now);
}

describe("0007 accounts", () => {
  it("rejects an organisation type outside the fixed list and negative beds", () => {
    const db = fresh();
    account(db);
    const insert = (type: string, beds: number | null) =>
      run(
        db,
        "INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_at) VALUES (?,?,?,?,?)",
        `${type}${beds}`,
        "a1",
        type,
        beds,
        now,
      );
    expect(() => insert("nonsense", null)).toThrow();
    expect(() => insert("health_system", -1)).toThrow();
    expect(() => insert("health_system", 300)).not.toThrow();
  });

  it("keeps classification history append-only and merged accounts read-only", () => {
    const db = fresh();
    account(db);
    run(
      db,
      "INSERT INTO account_classification (id, account_id, org_type, recorded_at) VALUES ('k1','a1','biotech',?)",
      now,
    );
    expect(() => run(db, "UPDATE account_classification SET org_type = 'payer'")).toThrow(
      /append-only/,
    );
    expect(() => run(db, "DELETE FROM account_classification")).toThrow(/append-only/);
    account(db, "a2");
    run(db, "UPDATE account SET merged_into = 'a2' WHERE id = 'a1'");
    expect(() => run(db, "UPDATE account SET name = 'x' WHERE id = 'a1'")).toThrow(/merged/);
  });

  it("allows one alias per normalised name per account", () => {
    const db = fresh();
    account(db);
    const alias = () =>
      run(
        db,
        "INSERT INTO account_alias (id, account_id, alias, alias_normalised, source, created_at) VALUES (?,?,?,?,?,?)",
        Math.random().toString(),
        "a1",
        "Acme Inc",
        "acme",
        "import",
        now,
      );
    alias();
    expect(alias).toThrow();
  });
});

describe("0008 contacts and the economic buyer rule (FR-033)", () => {
  function relationship(db: SqliteDatabase) {
    account(db);
    contact(db);
    run(
      db,
      "INSERT INTO stakeholder_role (key, label, sort) VALUES ('economic_buyer','Economic buyer',1)",
    );
    run(
      db,
      "INSERT INTO account_contact_relationship (id, account_id, contact_id, started_at) VALUES ('r1','a1','c1',?)",
      now,
    );
  }
  const evidence = (db: SqliteDatabase, status: string) =>
    run(
      db,
      "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?,?,?,?,?,?,?)",
      `e-${status}`,
      "a1",
      "economic_buyer_confirmation",
      "what",
      "ref",
      now,
      now,
      status,
    );

  it("refuses confirming an economic buyer without linked buyer_confirmed evidence, even by direct SQL", () => {
    const db = fresh();
    relationship(db);
    expect(() =>
      run(
        db,
        "UPDATE account_contact_relationship SET role_confirmed = 'economic_buyer' WHERE id = 'r1'",
      ),
    ).toThrow(/requires linked/);
    evidence(db, "observed");
    run(
      db,
      "INSERT INTO relationship_evidence VALUES ('r1','e-observed','role_confirmation','u',?)",
      now,
    );
    expect(() =>
      run(
        db,
        "UPDATE account_contact_relationship SET role_confirmed = 'economic_buyer' WHERE id = 'r1'",
      ),
    ).toThrow(/requires linked/);
    evidence(db, "buyer_confirmed");
    run(
      db,
      "INSERT INTO relationship_evidence VALUES ('r1','e-buyer_confirmed','role_confirmation','u',?)",
      now,
    );
    expect(() =>
      run(
        db,
        "UPDATE account_contact_relationship SET role_confirmed = 'economic_buyer' WHERE id = 'r1'",
      ),
    ).not.toThrow();
  });

  it("refuses inserting a relationship that is already confirmed", () => {
    const db = fresh();
    account(db);
    contact(db);
    run(
      db,
      "INSERT INTO stakeholder_role (key, label, sort) VALUES ('economic_buyer','Economic buyer',1)",
    );
    expect(() =>
      run(
        db,
        "INSERT INTO account_contact_relationship (id, account_id, contact_id, role_confirmed, started_at) VALUES ('r2','a1','c1','economic_buyer',?)",
        now,
      ),
    ).toThrow(/requires linked/);
  });

  it("limits evidence text and keeps evidence append-only; one active relationship per pair", () => {
    const db = fresh();
    relationship(db);
    expect(() =>
      run(
        db,
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES ('x','a1','other',?,?,?,?,'observed')",
        "y".repeat(501),
        "ref",
        now,
        now,
      ),
    ).toThrow();
    evidence(db, "observed");
    expect(() => run(db, "UPDATE evidence_reference SET what = 'z'")).toThrow(/append-only/);
    expect(() =>
      run(
        db,
        "INSERT INTO account_contact_relationship (id, account_id, contact_id, started_at) VALUES ('r9','a1','c1',?)",
        now,
      ),
    ).toThrow();
  });
});

describe("0009 ICP", () => {
  const def = (db: SqliteDatabase, id: string, version: number, state: string) =>
    run(
      db,
      "INSERT INTO icp_definition (id, icp, version, state, rules, created_at) VALUES (?,?,?,?,?,?)",
      id,
      "icp1",
      version,
      state,
      "{}",
      now,
    );

  it("allows one active version per ICP, immutable rules and forward-only state", () => {
    const db = fresh();
    def(db, "d1", 1, "active");
    expect(() => def(db, "d2", 2, "active")).toThrow();
    def(db, "d2", 2, "draft");
    expect(() => run(db, "UPDATE icp_definition SET rules = '{\"x\":1}' WHERE id = 'd2'")).toThrow(
      /immutable/,
    );
    expect(() => run(db, "UPDATE icp_definition SET state = 'retired' WHERE id = 'd2'")).toThrow(
      /invalid/,
    );
    run(db, "UPDATE icp_definition SET state = 'retired' WHERE id = 'd1'");
    run(db, "UPDATE icp_definition SET state = 'active' WHERE id = 'd2'");
  });

  it("requires a non-empty basis on assessments and keeps them append-only", () => {
    const db = fresh();
    account(db);
    def(db, "d1", 1, "active");
    const insert = (id: string, basis: string) =>
      run(
        db,
        `INSERT INTO icp_fit_assessment (id, account_id, icp, definition_id, definition_version, status,
           confidence, basis, met, unmet, missing, contradictory, inputs_hash, assessed_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id,
        "a1",
        "icp1",
        "d1",
        1,
        "unknown",
        "low",
        basis,
        "[]",
        "[]",
        "[]",
        "[]",
        "h",
        now,
      );
    expect(() => insert("f1", "[]")).toThrow();
    expect(() => insert("f2", "not json")).toThrow();
    expect(() => insert("f3", '[{"kind":"missing_info","ref":"org_type"}]')).not.toThrow();
    expect(() => run(db, "UPDATE icp_fit_assessment SET status = 'strong'")).toThrow(/append-only/);
    expect(() => run(db, "DELETE FROM icp_fit_assessment")).toThrow(/append-only/);
  });

  it("requires an override rationale of at least 10 characters and keeps history", () => {
    const db = fresh();
    account(db);
    const grant = (rationale: string) =>
      run(
        db,
        "INSERT INTO exclusion_override (id, account_id, action, rationale, decided_by, decided_at) VALUES (?,?,?,?,?,?)",
        Math.random().toString(),
        "a1",
        "grant",
        rationale,
        "admin",
        now,
      );
    expect(() => grant("short")).toThrow();
    expect(() => grant("A documented business reason")).not.toThrow();
    expect(() => run(db, "UPDATE exclusion_override SET action = 'revoke'")).toThrow(/append-only/);
  });
});

describe("0010 suppression, review, imports", () => {
  it("checks suppression scope targets and keeps history append-only", () => {
    const db = fresh();
    account(db);
    const add = (
      scope: string,
      contactId: string | null,
      accountId: string | null,
      hash: string | null,
    ) =>
      run(
        db,
        "INSERT INTO suppression_record (id, scope, contact_id, account_id, email_hash, action, reason, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?,?,?)",
        Math.random().toString(),
        scope,
        contactId,
        accountId,
        hash,
        "add",
        "reason",
        "u",
        now,
      );
    expect(() => add("contact", null, null, null)).toThrow();
    expect(() => add("account", null, null, null)).toThrow();
    expect(() => add("account", null, "a1", null)).not.toThrow();
    expect(() => add("contact", null, null, "hash")).not.toThrow();
    expect(() => run(db, "UPDATE suppression_record SET reason = 'x'")).toThrow(/append-only/);
    expect(() => run(db, "DELETE FROM suppression_record")).toThrow(/append-only/);
  });

  it("freezes a decided review item and has no column for import row content", () => {
    const db = fresh();
    run(
      db,
      "INSERT INTO review_item (id, kind, subject_a, reason_codes, pair_key, attribute_fingerprint, state, proposed_at) VALUES ('v1','merge_candidate','a','[]','p','f','open',?)",
      now,
    );
    run(db, "UPDATE review_item SET state = 'rejected' WHERE id = 'v1'");
    expect(() => run(db, "UPDATE review_item SET state = 'open' WHERE id = 'v1'")).toThrow(
      /decided/,
    );
    const cols = (db.raw.prepare("PRAGMA table_info(import_row)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(cols).toEqual([
      "import_run_id",
      "row_number",
      "outcome",
      "reason_codes",
      "entity_id",
      "matched_id",
    ]);
  });
});
