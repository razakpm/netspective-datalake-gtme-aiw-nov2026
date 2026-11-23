import { describe, expect, it } from "vitest";
import { migrate, SqliteDatabase } from "../src/index.js";
import { COLUMN_CLASSIFICATION } from "../src/classification.js";

// Migrations 0020-0022 (feature 006): constraints, triggers and the schema scan.
const now = "2026-11-23T00:00:00.000Z";
type V = string | number | null;
const TABLES = [
  "routing_rule_set",
  "offer_recommendation",
  "offer_waitlist_entry",
  "notice_version",
  "offer_request",
  "consent_record",
  "lead_magnet_download",
  "intake_submission",
];

function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  insert(db, "account", {
    id: "a1",
    name: "Acme",
    name_normalised: "acme",
    created_at: now,
    updated_at: now,
  });
  insert(db, "contact", { id: "c1", created_at: now, updated_at: now });
  insert(db, "engagement_offer", {
    id: "o1",
    number: 1,
    key: "k1",
    latest_version_no: 1,
    lock_no: 1,
    created_at: now,
  });
  return db;
}
function insert(db: SqliteDatabase, table: string, row: Record<string, V>) {
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}
const ruleSet = (
  db: SqliteDatabase,
  version: number,
  state = "draft",
  over: Record<string, V> = {},
) =>
  insert(db, "routing_rule_set", {
    version,
    rules_json: '{"rules":[]}',
    state,
    author: "u1",
    reason: "first version",
    created_at: now,
    ...over,
  });
const recommendation = (db: SqliteDatabase, id = "r1", over: Record<string, V> = {}) =>
  insert(db, "offer_recommendation", {
    id,
    account_id: "a1",
    trigger: "operator",
    rule_set_version: 1,
    outcome: "research",
    outreach: "allowed",
    blocked_reasons_json: "[]",
    eligible_json: "[]",
    excluded_json: "[]",
    matched_json: "[]",
    alternatives_json: "[]",
    explanation: "Further research is recommended.",
    limitations_json: "[]",
    inputs_hash: "h",
    created_at: now,
    ...over,
  });
const request = (db: SqliteDatabase, id = "q1", over: Record<string, V> = {}) =>
  insert(db, "offer_request", {
    id,
    offer_id: "o1",
    form_slug: "k1",
    kind: "download",
    email_hash: "eh",
    submitted_at: now,
    ...over,
  });
const notice = (db: SqliteDatabase, id = "n1", version = 1) =>
  insert(db, "notice_version", {
    id,
    version,
    notice_text: "Notice",
    consent_text: "Consent",
    created_by: "author",
    created_at: now,
  });
const fails = (fn: () => void, pattern: RegExp) => expect(fn).toThrow(pattern);

describe("migrations 0020-0022", () => {
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

  it("has no column that could hold a price, budget, credential or intent", () => {
    const db = fresh();
    const banned =
      /price|fee|rate|cost|amount|currency|budget|password|secret|credential|intent|qualif/i;
    for (const t of TABLES) {
      const cols = (db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      for (const c of cols) expect(c, `${t}.${c}`).not.toMatch(banned);
    }
  });
});

describe("routing_rule_set", () => {
  it("allows one active version and refuses a second", () => {
    const db = fresh();
    ruleSet(db, 1, "active");
    fails(() => ruleSet(db, 2, "active"), /UNIQUE/);
    ruleSet(db, 2, "draft");
  });
  it("needs a reason of at least 3 characters and valid JSON", () => {
    const db = fresh();
    fails(() => ruleSet(db, 1, "draft", { reason: "ab" }), /CHECK/);
    fails(() => ruleSet(db, 1, "draft", { rules_json: "{" }), /CHECK/);
  });
  it("never changes its rules and moves only draft to active to retired", () => {
    const db = fresh();
    ruleSet(db, 1);
    fails(
      () => db.raw.prepare("UPDATE routing_rule_set SET rules_json = '{}' WHERE version = 1").run(),
      /immutable/,
    );
    fails(
      () => db.raw.prepare("UPDATE routing_rule_set SET state = 'retired' WHERE version = 1").run(),
      /invalid routing rule set state/,
    );
    db.raw
      .prepare(
        "UPDATE routing_rule_set SET state = 'active', activated_by = 'u2', activated_at = ?, tests_passed_at = ? WHERE version = 1",
      )
      .run(now, now);
    db.raw.prepare("UPDATE routing_rule_set SET state = 'retired' WHERE version = 1").run();
    fails(
      () => db.raw.prepare("UPDATE routing_rule_set SET state = 'active' WHERE version = 1").run(),
      /invalid routing rule set state/,
    );
    fails(
      () => db.raw.prepare("DELETE FROM routing_rule_set WHERE version = 1").run(),
      /cannot be deleted/,
    );
  });
});

describe("offer_recommendation", () => {
  it("needs an offer when the outcome is offer, and an explanation of at most 600 characters", () => {
    const db = fresh();
    ruleSet(db, 1, "active");
    fails(() => recommendation(db, "r1", { outcome: "offer" }), /CHECK/);
    fails(() => recommendation(db, "r1", { explanation: "x".repeat(601) }), /CHECK/);
    recommendation(db, "r1", { outcome: "offer", offer_id: "o1" });
  });
  it("changes only its review, once, from pending", () => {
    const db = fresh();
    ruleSet(db, 1, "active");
    recommendation(db);
    fails(
      () =>
        db.raw.prepare("UPDATE offer_recommendation SET explanation = 'x' WHERE id = 'r1'").run(),
      /append-only/,
    );
    fails(
      () =>
        db.raw
          .prepare("UPDATE offer_recommendation SET review_state = 'accepted' WHERE id = 'r1'")
          .run(),
      /reviewed once/,
    );
    db.raw
      .prepare(
        "UPDATE offer_recommendation SET review_state = 'dismissed', reviewed_by = 'u1', reviewed_at = ?, review_reason = 'not now' WHERE id = 'r1'",
      )
      .run(now);
    fails(
      () =>
        db.raw
          .prepare(
            "UPDATE offer_recommendation SET review_state = 'accepted', reviewed_by = 'u1', reviewed_at = ? WHERE id = 'r1'",
          )
          .run(now),
      /reviewed once/,
    );
    fails(
      () => db.raw.prepare("DELETE FROM offer_recommendation WHERE id = 'r1'").run(),
      /append-only/,
    );
  });
});

describe("offer_waitlist_entry", () => {
  const entry = (db: SqliteDatabase, over: Record<string, V> = {}) =>
    insert(db, "offer_waitlist_entry", {
      id: "w1",
      offer_id: "o1",
      account_id: "a1",
      reason: "Offer is full",
      added_by: "u1",
      added_at: now,
      ...over,
    });
  it("needs a reason of at least 3 characters", () => {
    fails(() => entry(fresh(), { reason: "ab" }), /CHECK/);
  });
  it("closes once, with a reason, and never changes otherwise", () => {
    const db = fresh();
    entry(db);
    fails(
      () =>
        db.raw
          .prepare("UPDATE offer_waitlist_entry SET reason = 'other reason' WHERE id = 'w1'")
          .run(),
      /only when it is closed/,
    );
    fails(
      () =>
        db.raw
          .prepare(
            "UPDATE offer_waitlist_entry SET state = 'released', closed_by = 'u1', closed_at = ? WHERE id = 'w1'",
          )
          .run(now),
      /closed once/,
    );
    db.raw
      .prepare(
        "UPDATE offer_waitlist_entry SET state = 'released', closed_by = 'u1', closed_at = ?, closed_reason = 'place open' WHERE id = 'w1'",
      )
      .run(now);
    fails(
      () =>
        db.raw
          .prepare(
            "UPDATE offer_waitlist_entry SET state = 'removed', closed_by = 'u1', closed_at = ?, closed_reason = 'again' WHERE id = 'w1'",
          )
          .run(now),
      /closed once/,
    );
  });
});

describe("notice_version", () => {
  it("never changes its text and is approved once by someone other than the author", () => {
    const db = fresh();
    notice(db);
    fails(
      () => db.raw.prepare("UPDATE notice_version SET notice_text = 'x' WHERE id = 'n1'").run(),
      /never changes/,
    );
    fails(
      () =>
        db.raw
          .prepare(
            "UPDATE notice_version SET approved_by = 'author', approved_at = ? WHERE id = 'n1'",
          )
          .run(now),
      /other than its author/,
    );
    db.raw
      .prepare(
        "UPDATE notice_version SET approved_by = 'approver', approved_at = ? WHERE id = 'n1'",
      )
      .run(now);
    fails(
      () =>
        db.raw
          .prepare(
            "UPDATE notice_version SET approved_by = 'someone', approved_at = ? WHERE id = 'n1'",
          )
          .run(now),
      /approved once/,
    );
    fails(
      () => db.raw.prepare("DELETE FROM notice_version WHERE id = 'n1'").run(),
      /cannot be deleted/,
    );
  });
  it("limits the text lengths and keeps versions unique", () => {
    const db = fresh();
    fails(
      () =>
        insert(db, "notice_version", {
          id: "n2",
          version: 1,
          notice_text: "x".repeat(4001),
          consent_text: "c",
          created_by: "a",
          created_at: now,
        }),
      /CHECK/,
    );
    fails(
      () =>
        insert(db, "notice_version", {
          id: "n2",
          version: 1,
          notice_text: "n",
          consent_text: "x".repeat(601),
          created_by: "a",
          created_at: now,
        }),
      /CHECK/,
    );
    notice(db);
    fails(() => notice(db, "n2", 1), /UNIQUE/);
  });
});

describe("offer_request, consent_record and lead_magnet_download", () => {
  it("accepts only the three kinds and moves received to reviewed, linked or closed", () => {
    const db = fresh();
    fails(() => request(db, "q1", { kind: "sale" }), /CHECK/);
    request(db);
    fails(
      () =>
        db.raw.prepare("UPDATE offer_request SET email = 'x@example.org' WHERE id = 'q1'").run(),
      /state, link and review/,
    );
    db.raw
      .prepare(
        "UPDATE offer_request SET state = 'reviewed', reviewed_by = 'u1', reviewed_at = ? WHERE id = 'q1'",
      )
      .run(now);
    fails(
      () => db.raw.prepare("UPDATE offer_request SET state = 'received' WHERE id = 'q1'").run(),
      /invalid request state/,
    );
    db.raw
      .prepare(
        "UPDATE offer_request SET state = 'linked', account_id = 'a1', contact_id = 'c1' WHERE id = 'q1'",
      )
      .run();
    fails(
      () => db.raw.prepare("DELETE FROM offer_request WHERE id = 'q1'").run(),
      /cannot be deleted/,
    );
  });
  it("keeps consent records and downloads append-only, one download per request", () => {
    const db = fresh();
    notice(db);
    request(db);
    insert(db, "consent_record", {
      id: "cr1",
      request_id: "q1",
      email_hash: "eh",
      notice_version_id: "n1",
      consent_given: 1,
      recorded_at: now,
    });
    fails(
      () => db.raw.prepare("UPDATE consent_record SET consent_given = 0 WHERE id = 'cr1'").run(),
      /append-only/,
    );
    fails(() => db.raw.prepare("DELETE FROM consent_record WHERE id = 'cr1'").run(), /append-only/);
    insert(db, "lead_magnet_download", {
      id: "d1",
      request_id: "q1",
      offer_id: "o1",
      delivered: 1,
      created_at: now,
    });
    fails(
      () =>
        insert(db, "lead_magnet_download", {
          id: "d2",
          request_id: "q1",
          offer_id: "o1",
          delivered: 1,
          created_at: now,
        }),
      /UNIQUE/,
    );
    fails(
      () => db.raw.prepare("UPDATE lead_magnet_download SET delivered = 0 WHERE id = 'd1'").run(),
      /append-only/,
    );
    fails(
      () => db.raw.prepare("DELETE FROM lead_magnet_download WHERE id = 'd1'").run(),
      /append-only/,
    );
  });
});

describe("intake_submission", () => {
  const intake = (db: SqliteDatabase, over: Record<string, V> = {}) =>
    insert(db, "intake_submission", {
      id: "i1",
      request_id: "q1",
      offer_id: "o1",
      kind: "offer_1",
      schema_version: 1,
      payload_json: "{}",
      classification: "non_phi",
      submitted_at: now,
      ...over,
    });
  it("accepts only the non_phi classification and the two kinds, one per request", () => {
    const db = fresh();
    request(db, "q1", { kind: "intake" });
    fails(() => intake(db, { classification: "phi" }), /CHECK/);
    fails(() => intake(db, { kind: "offer_2" }), /CHECK/);
    intake(db);
    fails(() => intake(db, { id: "i2" }), /UNIQUE/);
  });
  it("changes only its review state, from pending to reviewed", () => {
    const db = fresh();
    request(db, "q1", { kind: "intake" });
    intake(db);
    fails(
      () =>
        db.raw
          .prepare("UPDATE intake_submission SET payload_json = '{\"a\":1}' WHERE id = 'i1'")
          .run(),
      /append-only/,
    );
    db.raw.prepare("UPDATE intake_submission SET review_state = 'reviewed' WHERE id = 'i1'").run();
    fails(
      () =>
        db.raw
          .prepare("UPDATE intake_submission SET review_state = 'pending' WHERE id = 'i1'")
          .run(),
      /invalid intake review/,
    );
    fails(
      () => db.raw.prepare("DELETE FROM intake_submission WHERE id = 'i1'").run(),
      /append-only/,
    );
  });
});
