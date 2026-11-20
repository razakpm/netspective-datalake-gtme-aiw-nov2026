import { describe, expect, it } from "vitest";
import { migrate, SqliteDatabase } from "../src/index.js";
import { COLUMN_CLASSIFICATION } from "../src/classification.js";

// Migrations 0017-0019 (feature 005): constraints, triggers and the schema scan (task T005).
const now = "2026-11-19T00:00:00.000Z";
type V = string | number | null;
const TABLES = [
  "restricted_phrase_list",
  "claim",
  "claim_evidence",
  "claim_review",
  "lint_disposition",
  "engagement_offer",
  "offer_version",
  "offer_version_status",
  "offer_limitation",
  "offer_limitation_ack",
  "offer_capacity",
  "offer_session_booking",
  "offer_score_criterion",
  "offer_score",
  "paid_engagement_type",
  "paid_engagement_deliverable",
  "service_capability",
  "capability_evidence",
  "capability_delivery_example",
  "capability_offer_link",
];

function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  return db;
}
const insert = (db: SqliteDatabase, table: string, row: Record<string, V>) => {
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...Object.values(row));
};
const claim = (db: SqliteDatabase, over: Record<string, V> = {}) =>
  insert(db, "claim", {
    id: `c-${Math.random()}`,
    text: "We review sender feeds.",
    declared_class: null,
    effective_class: "general",
    status: "draft",
    drafted_by: "u-draft",
    drafted_at: now,
    version_no: 1,
    ...over,
  });
const offer = (db: SqliteDatabase, id = "offer-x", number = 1) =>
  insert(db, "engagement_offer", {
    id,
    number,
    key: `key-${id}`,
    latest_version_no: 1,
    in_force_version_no: null,
    lock_no: 1,
    created_at: now,
  });
const version = (db: SqliteDatabase, offerId = "offer-x", no = 1) =>
  insert(db, "offer_version", {
    offer_id: offerId,
    version_no: no,
    snapshot_json: "{}",
    snapshot_hash: "h",
    reason: "initial",
    created_by: "u1",
    created_at: now,
  });
const capability = (db: SqliteDatabase, slot = 1, over: Record<string, V> = {}) =>
  insert(db, "service_capability", {
    id: `capability-${slot}`,
    slot,
    public_claim_status: "not_approved",
    lock_no: 1,
    ...over,
  });

describe("migrations 0017-0019", () => {
  it("apply forward-only and create every table", () => {
    const db = fresh();
    expect(migrate(db)).toEqual([]);
    const names = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("registers every table and column in the column classification", () => {
    const db = fresh();
    for (const t of TABLES) {
      const registered = Object.keys(COLUMN_CLASSIFICATION[t] ?? {});
      const actual = (db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(registered.sort(), t).toEqual(actual.sort());
    }
  });

  it("classifies delivery example text as internal case study restricted", () => {
    expect(COLUMN_CLASSIFICATION["capability_delivery_example"]?.["text"]).toBe(
      "internal_case_study_restricted",
    );
  });
});

describe("append-only tables", () => {
  const refuse = (db: SqliteDatabase, sql: string, ...args: V[]) =>
    expect(() => db.raw.prepare(sql).run(...args)).toThrow(/append-only/);

  it("refuse UPDATE and DELETE on every history table", () => {
    const db = fresh();
    insert(db, "restricted_phrase_list", {
      version: 1,
      rules_json: "[]",
      owner: "campaign_approver",
      reviewed_by: "seed",
      reviewed_at: now,
      created_by: "seed-author",
      created_at: now,
    });
    claim(db, { id: "c1" });
    insert(db, "claim_review", {
      id: "r1",
      claim_id: "c1",
      decision: "approve",
      reviewer_id: "u2",
      note: "fine",
      decided_at: now,
    });
    insert(db, "lint_disposition", {
      id: "d1",
      sentence_hash: "abc",
      rule_id: "sla",
      reason: "fine",
      reviewer_id: "u2",
      decided_at: now,
    });
    offer(db);
    version(db);
    insert(db, "offer_version_status", {
      id: "s1",
      offer_id: "offer-x",
      version_no: 1,
      status: "draft",
      changed_by: "u1",
      changed_at: now,
    });
    insert(db, "offer_limitation", {
      id: "l1",
      offer_id: "offer-x",
      key: "k",
      wording: "w",
      active: 1,
    });
    insert(db, "offer_limitation_ack", {
      id: "a1",
      limitation_id: "l1",
      wording_hash: "h",
      acknowledged_by: "u1",
      acknowledged_at: now,
    });
    insert(db, "offer_capacity", {
      id: "cap1",
      offer_id: "offer-x",
      period_kind: "month",
      limit_sessions: 3,
      effective_from: "2026-11-01",
      set_by: "u1",
      set_at: now,
    });
    insert(db, "offer_score_criterion", { key: "fit", label: "Fit", position: 1 });
    insert(db, "offer_score", {
      id: "sc1",
      offer_id: "offer-x",
      criterion_key: "fit",
      score: 3,
      status: "hypothesis",
      set_by: "u1",
      set_at: now,
    });
    const history: [string, string, string][] = [
      ["restricted_phrase_list", "version", "owner"],
      ["claim_review", "id", "note"],
      ["lint_disposition", "id", "reason"],
      ["offer_version", "offer_id", "reason"],
      ["offer_version_status", "id", "note"],
      ["offer_limitation_ack", "id", "acknowledged_by"],
      ["offer_capacity", "id", "reason"],
      ["offer_score", "id", "rationale"],
    ];
    for (const [table, key, col] of history) {
      const id = (db.raw.prepare(`SELECT ${key} AS k FROM ${table}`).get() as { k: V }).k;
      refuse(db, `UPDATE ${table} SET ${col} = 'changed' WHERE ${key} = ?`, id);
      refuse(db, `DELETE FROM ${table} WHERE ${key} = ?`, id);
    }
  });

  it("lets evidence be withdrawn once and never edited or deleted", () => {
    const db = fresh();
    claim(db, { id: "c1" });
    insert(db, "claim_evidence", {
      id: "e1",
      claim_id: "c1",
      kind: "document",
      reference: "doc-1",
      owner: "u1",
      added_by: "u1",
      added_at: now,
      expires_at: "2027-11-19T00:00:00.000Z",
    });
    expect(() =>
      db.raw.prepare("UPDATE claim_evidence SET reference = 'other' WHERE id = 'e1'").run(),
    ).toThrow();
    db.raw
      .prepare("UPDATE claim_evidence SET withdrawn_at = ?, withdrawn_by = 'u1' WHERE id = 'e1'")
      .run(now);
    expect(() =>
      db.raw.prepare("UPDATE claim_evidence SET withdrawn_by = 'u2' WHERE id = 'e1'").run(),
    ).toThrow();
    expect(() => db.raw.prepare("DELETE FROM claim_evidence WHERE id = 'e1'").run()).toThrow();
  });
});

describe("constraints", () => {
  it("restricted_phrase_list: the reviewer differs from the author", () => {
    const db = fresh();
    const row = {
      version: 1,
      rules_json: "[]",
      owner: "campaign_approver",
      reviewed_by: "same",
      reviewed_at: now,
      created_by: "same",
      created_at: now,
    };
    expect(() => insert(db, "restricted_phrase_list", row)).toThrow();
    insert(db, "restricted_phrase_list", { ...row, reviewed_by: "other" });
  });

  it("claim: text is not null and at most 600 characters; status has no needs_review", () => {
    const db = fresh();
    expect(() => claim(db, { text: "x".repeat(601) })).toThrow();
    expect(() => claim(db, { text: "" })).toThrow();
    claim(db, { text: "x".repeat(600) });
    expect(() => claim(db, { status: "needs_review" })).toThrow();
    expect(() => claim(db, { declared_class: "made_up" })).toThrow();
    for (const status of ["draft", "in_review", "approved", "rejected", "withdrawn"]) {
      claim(db, { status });
    }
  });

  it("claim_review: unique per claim, reviewer and decision; note of at least 3 characters; not the drafter", () => {
    const db = fresh();
    claim(db, { id: "c1", drafted_by: "u-draft" });
    const review = (over: Record<string, V> = {}) =>
      insert(db, "claim_review", {
        id: `r-${Math.random()}`,
        claim_id: "c1",
        decision: "approve",
        reviewer_id: "u2",
        note: "fine",
        decided_at: now,
        ...over,
      });
    expect(() => review({ note: "ok" })).toThrow();
    expect(() => review({ reviewer_id: "u-draft" })).toThrow(/drafter/);
    review();
    expect(() => review()).toThrow();
    review({ reviewer_id: "u3" });
  });

  it("engagement_offer: number is unique and between 1 and 10", () => {
    const db = fresh();
    expect(() => offer(db, "o0", 0)).toThrow();
    expect(() => offer(db, "o11", 11)).toThrow();
    offer(db, "o1", 1);
    expect(() => offer(db, "o1b", 1)).toThrow();
  });

  it("offer_version_status: only the six statuses, and only for an existing version", () => {
    const db = fresh();
    offer(db);
    version(db);
    const status = (s: string, no = 1) =>
      insert(db, "offer_version_status", {
        id: `s-${Math.random()}`,
        offer_id: "offer-x",
        version_no: no,
        status: s,
        changed_by: "seed",
        changed_at: now,
      });
    for (const s of [
      "draft",
      "internally_reviewed",
      "approved",
      "available",
      "withdrawn",
      "expired",
    ])
      status(s);
    expect(() => status("superseded")).toThrow();
    expect(() => status("draft", 9)).toThrow();
  });

  it("offer_capacity: a limit of zero or more and a known period kind", () => {
    const db = fresh();
    offer(db);
    const cap = (over: Record<string, V>) =>
      insert(db, "offer_capacity", {
        id: `c-${Math.random()}`,
        offer_id: "offer-x",
        period_kind: "week",
        limit_sessions: 0,
        effective_from: "2026-11-02",
        set_by: "u1",
        set_at: now,
        ...over,
      });
    cap({});
    expect(() => cap({ limit_sessions: -1 })).toThrow();
    expect(() => cap({ period_kind: "day" })).toThrow();
  });

  it("offer_session_booking: unique external reference per offer when present; known states and sources", () => {
    const db = fresh();
    offer(db);
    const booking = (over: Record<string, V>) =>
      insert(db, "offer_session_booking", {
        id: `b-${Math.random()}`,
        offer_id: "offer-x",
        external_ref: null,
        state: "booked",
        session_date: "2026-11-20",
        period_start: "2026-11-01",
        source: "manual",
        recorded_by: "u1",
        recorded_at: now,
        updated_at: now,
        ...over,
      });
    booking({});
    booking({});
    booking({ external_ref: "w-1" });
    expect(() => booking({ external_ref: "w-1" })).toThrow();
    expect(() => booking({ state: "rescheduled" })).toThrow();
    expect(() => booking({ source: "import" })).toThrow();
    for (const state of ["held", "cancelled", "no_show"]) booking({ state });
  });

  it("offer_score: status must be 'hypothesis'", () => {
    const db = fresh();
    offer(db);
    insert(db, "offer_score_criterion", { key: "fit", label: "Fit", position: 1 });
    const score = (status: string) =>
      insert(db, "offer_score", {
        id: `s-${Math.random()}`,
        offer_id: "offer-x",
        criterion_key: "fit",
        score: 3,
        status,
        set_by: "u1",
        set_at: now,
      });
    score("hypothesis");
    expect(() => score("confirmed")).toThrow();
  });

  it("paid_engagement_deliverable: a deliverable outside the source needs an approver to be approved", () => {
    const db = fresh();
    insert(db, "paid_engagement_type", {
      key: "input_audit",
      name: "Input Audit",
      scope_json: "[]",
      scope_confirmed: 1,
      status: "active",
      lock_no: 1,
    });
    const deliverable = (over: Record<string, V>) =>
      insert(db, "paid_engagement_deliverable", {
        id: `d-${Math.random()}`,
        type_key: "input_audit",
        text: "A go/no-go memo",
        in_source: 0,
        approval: "pending_approval",
        approved_by: null,
        decided_at: null,
        ...over,
      });
    deliverable({});
    deliverable({ in_source: 1, approval: "approved" });
    expect(() => deliverable({ approval: "approved" })).toThrow();
    deliverable({ approval: "approved", approved_by: "u9", decided_at: now });
    expect(() => deliverable({ approval: "maybe" })).toThrow();
  });

  it("service_capability: slot is unique and between 1 and 19; approval needs a claim and a name", () => {
    const db = fresh();
    expect(() => capability(db, 0)).toThrow();
    expect(() => capability(db, 20)).toThrow();
    capability(db, 1);
    expect(() => capability(db, 1, { id: "capability-dup" })).toThrow();
    expect(() => capability(db, 2, { public_claim_status: "approved" })).toThrow();
    claim(db, { id: "c-approved", status: "approved" });
    capability(db, 3, {
      public_claim_status: "approved",
      public_claim_id: "c-approved",
      name: "Sender readiness",
    });
    expect(() => capability(db, 4, { public_claim_status: "public" })).toThrow();
  });

  it("capability_delivery_example: text is not empty and at most 800 characters", () => {
    const db = fresh();
    capability(db, 1);
    const example = (text: string) =>
      insert(db, "capability_delivery_example", {
        id: `e-${Math.random()}`,
        capability_id: "capability-1",
        text,
        added_by: "u1",
        added_at: now,
      });
    example("x".repeat(800));
    expect(() => example("x".repeat(801))).toThrow();
    expect(() => example("")).toThrow();
  });
});

describe("schema scan", () => {
  it("has no price, fee, rate, cost, amount or currency column on any feature 005 table", () => {
    const db = fresh();
    const banned = /(^|_)(price|pricing|fee|fees|rate|rates|cost|amount|currency)(_|$)/;
    for (const t of TABLES) {
      for (const c of db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]) {
        expect(`${t}.${c.name}`).not.toMatch(banned);
      }
    }
  });

  it("has no column that can hold a computed status or usage counter", () => {
    const db = fresh();
    const banned = /(^|_)(needs_review|used|usage|utilisation|exhausted|superseded)(_|$)/;
    for (const t of TABLES) {
      for (const c of db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]) {
        expect(`${t}.${c.name}`).not.toMatch(banned);
      }
    }
  });
});
