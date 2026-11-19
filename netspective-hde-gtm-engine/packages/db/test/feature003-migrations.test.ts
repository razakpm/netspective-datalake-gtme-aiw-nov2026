import { describe, expect, it } from "vitest";
import { migrate, seedReference, SqliteDatabase } from "../src/index.js";

// Migrations 0011-0013 (feature 003): constraints, triggers and the schema scan (tasks T006, T012).
const now = "2026-11-17T00:00:00.000Z";
function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
    )
    .run(now, now);
  return db;
}
const sourceId = "default-source-official_publication";

type Over = Record<string, string | number | null>;
function insertSignal(db: SqliteDatabase, over: Over = {}) {
  const row: Over = {
    id: `s-${Math.random().toString(36).slice(2)}`,
    account_id: "a1",
    type_key: "procurement_notice",
    taxonomy_version: 1,
    source_id: sourceId,
    source_ref: "https://example.org/n/1",
    source_ref_normalised: "https://example.org/n/1",
    observation: "An RFP was published.",
    observed_at: now,
    collected_at: now,
    reliability: "high",
    extraction_method: "manual",
    extraction_confidence: "high",
    evidence_status: "observed",
    freshness_days: 120,
    fresh_until: "2027-03-17T00:00:00.000Z",
    retention_policy: "business_record",
    retain_until: "2029-11-17T00:00:00.000Z",
    sensitivity: "public",
    content_fingerprint: `fp-${Math.random()}`,
    created_by_type: "human",
    created_at: now,
    updated_at: now,
    ...over,
  };
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO signal (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...Object.values(row));
  return row["id"] as string;
}

describe("0011 taxonomy and sources", () => {
  it("seeds exactly one current taxonomy version with all nine categories and default sources", () => {
    const db = fresh();
    const cur = db.raw.prepare("SELECT version FROM taxonomy_version WHERE status='current'").all();
    expect(cur).toHaveLength(1);
    const cats = db.raw
      .prepare("SELECT DISTINCT category FROM signal_type ORDER BY category")
      .all() as { category: string }[];
    expect(cats.map((c) => c.category)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
    expect((db.raw.prepare("SELECT count(*) c FROM signal_source").get() as { c: number }).c).toBe(
      7,
    );
    // idempotent re-seed
    db.transaction((tx) => seedReference(tx));
    expect((db.raw.prepare("SELECT count(*) c FROM signal_source").get() as { c: number }).c).toBe(
      7,
    );
  });
  it("refuses a second current version, and kind/category mismatches", () => {
    const db = fresh();
    expect(() =>
      db.raw
        .prepare("INSERT INTO taxonomy_version (version,status,released_at) VALUES (2,'current',?)")
        .run(now),
    ).toThrow();
    const ins = (key: string, cat: string, kind: string, ctx: number) =>
      db.raw
        .prepare(
          "INSERT INTO signal_type (taxonomy_version,key,category,label,kind,default_freshness_days,default_reliability,context_only) VALUES (1,?,?,?,?,10,'low',?)",
        )
        .run(key, cat, key, kind, ctx);
    expect(() => ins("x1", "H", "general", 0)).toThrow();
    expect(() => ins("x2", "A", "regulatory", 1)).toThrow();
    expect(() => ins("x3", "H", "regulatory", 0)).toThrow();
    expect(() => ins("x4", "I", "general", 0)).toThrow();
    expect(() => ins("x5", "A", "funding", 0)).toThrow();
  });
  it("keeps citation-only sources free of an excerpt limit and never deletes sources", () => {
    const db = fresh();
    const ins = (limit: number | null) =>
      db.raw
        .prepare(
          "INSERT INTO signal_source (id,name,kind,default_reliability,storage_rule,excerpt_max_chars,created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(`s${limit}`, `n${limit}`, "other", "low", "citation_only", limit, now);
    expect(() => ins(50)).toThrow();
    expect(() => ins(0)).not.toThrow();
    expect(() => db.raw.prepare("DELETE FROM signal_source").run()).toThrow();
  });
});

describe("0012 signals", () => {
  it("requires a source and reference, limits length, and enforces AI and buyer rules at the database", () => {
    const db = fresh();
    expect(() => insertSignal(db, { source_ref: "" })).toThrow();
    expect(() => insertSignal(db, { source_id: "missing" })).toThrow();
    expect(() => insertSignal(db, { observation: "x".repeat(1001) })).toThrow();
    expect(() => insertSignal(db, { extraction_method: "ai_extracted" })).toThrow();
    expect(() =>
      insertSignal(db, {
        extraction_method: "ai_extracted",
        ai_model: "m",
        ai_prompt_version: "v",
        created_by_type: "ai",
      }),
    ).not.toThrow();
    expect(() =>
      insertSignal(db, {
        evidence_status: "buyer_confirmed",
        created_by_type: "ai",
        extraction_method: "manual",
      }),
    ).toThrow();
    expect(() =>
      insertSignal(db, { evidence_status: "buyer_confirmed", extraction_method: "provider" }),
    ).toThrow();
    expect(() => insertSignal(db, { evidence_status: "buyer_confirmed" })).not.toThrow();
    expect(() =>
      insertSignal(db, { created_by_type: "system", review_status: "approved" }),
    ).toThrow();
    expect(() => insertSignal(db, { sensitivity: "prohibited" })).toThrow();
    expect(() =>
      insertSignal(db, { excerpt: "text", excerpt_withheld_reason: "too_long" }),
    ).toThrow();
  });
  it("guards funding and regulatory fields", () => {
    const db = fresh();
    expect(() => insertSignal(db, { funding_class: "context" })).toThrow();
    expect(() =>
      insertSignal(db, { type_key: "grant_funding_announcement", funding_class: "context" }),
    ).not.toThrow();
    expect(() =>
      insertSignal(db, {
        type_key: "budget_approval_statement",
        funding_class: "budget_approval_evidence",
      }),
    ).toThrow();
    expect(() =>
      insertSignal(db, {
        type_key: "budget_approval_statement",
        funding_class: "budget_approval_evidence",
        approval_citation: "Board approved",
      }),
    ).not.toThrow();
    const reg = { type_key: "regulatory_ecosystem_item" };
    expect(() => insertSignal(db, reg)).toThrow();
    expect(() =>
      insertSignal(db, {
        ...reg,
        regulatory_status: "unverified",
        context_only: 1,
        reverify_required: 0,
      }),
    ).toThrow();
    expect(() =>
      insertSignal(db, {
        ...reg,
        regulatory_status: "unverified",
        context_only: 1,
        reverify_required: 1,
      }),
    ).not.toThrow();
    expect(() => insertSignal(db, { regulatory_status: "proposed" })).toThrow();
  });
  it("makes observations immutable, allows review state to change, and never deletes", () => {
    const db = fresh();
    const id = insertSignal(db);
    const upd = (set: string, v: string | number | null) =>
      db.raw.prepare(`UPDATE signal SET ${set} = ? WHERE id = ?`).run(v, id);
    for (const [col, v] of [
      ["observation", "changed"],
      ["excerpt", "x"],
      ["account_id", "a2"],
      ["type_key", "x"],
      ["observed_at", "2020-01-01"],
      ["content_fingerprint", "z"],
      ["source_ref", "z"],
    ] as const) {
      expect(() => upd(col, v)).toThrow();
    }
    expect(() => upd("review_status", "approved")).not.toThrow();
    expect(() => upd("new_provenance_flag", 1)).not.toThrow();
    expect(() => upd("reliability", "low")).not.toThrow();
    expect(() => db.raw.prepare("DELETE FROM signal WHERE id = ?").run(id)).toThrow();
  });
  it("allows clearing the contact and purging, but not setting another contact", () => {
    const db = fresh();
    db.raw
      .prepare("INSERT INTO contact (id, created_at, updated_at) VALUES ('c1',?,?)")
      .run(now, now);
    const id = insertSignal(db, { contact_id: "c1" });
    expect(() =>
      db.raw.prepare("UPDATE signal SET contact_id = 'c1' WHERE id = ?").run(id),
    ).not.toThrow();
    expect(() =>
      db.raw.prepare("UPDATE signal SET contact_id = NULL WHERE id = ?").run(id),
    ).not.toThrow();
    expect(() =>
      db.raw
        .prepare(
          "UPDATE signal SET observation = '[removed]', excerpt = NULL, purged_at = ? WHERE id = ?",
        )
        .run(now, id),
    ).not.toThrow();
  });
  it("is unique per account, type and fingerprint, and per item key", () => {
    const db = fresh();
    insertSignal(db, { content_fingerprint: "same", item_key: "RFP-1" });
    expect(() => insertSignal(db, { content_fingerprint: "same" })).toThrow();
    expect(() => insertSignal(db, { item_key: "RFP-1" })).toThrow();
    expect(() =>
      insertSignal(db, { type_key: "program_announcement", content_fingerprint: "same" }),
    ).not.toThrow();
  });
  it("keeps provenance, links and tags append-only and constrained", () => {
    const db = fresh();
    const id = insertSignal(db);
    db.raw
      .prepare(
        "INSERT INTO signal_provenance (id,signal_id,seq,kind,actor_type,occurred_at) VALUES ('p1',?,1,'first_recorded','human',?)",
      )
      .run(id, now);
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO signal_provenance (id,signal_id,seq,kind,actor_type,occurred_at) VALUES ('p2',?,1,'reviewed','human',?)",
        )
        .run(id, now),
    ).toThrow();
    expect(() => db.raw.prepare("UPDATE signal_provenance SET detail='{}'").run()).toThrow();
    expect(() => db.raw.prepare("DELETE FROM signal_provenance").run()).toThrow();
    db.raw
      .prepare(
        "INSERT INTO signal_link (id,signal_id,entity_type,entity_id,role,linked_at) VALUES ('l1',?,'signal','x','supporting',?)",
      )
      .run(id, now);
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO signal_link (id,signal_id,entity_type,entity_id,role,linked_at) VALUES ('l2',?,'signal','x','supporting',?)",
        )
        .run(id, now),
    ).toThrow();
    expect(() => db.raw.prepare("DELETE FROM signal_link").run()).toThrow();
    const tag = (d: string, v: string) =>
      db.raw
        .prepare("INSERT INTO signal_tag (signal_id,dimension,value) VALUES (?,?,?)")
        .run(id, d, v);
    expect(() => tag("icp", "icp3")).toThrow();
    expect(() => tag("icp", "icp1")).not.toThrow();
  });
});

describe("0013 review", () => {
  it("enforces decision rules, is append-only and resolves a contradiction once", () => {
    const db = fresh();
    const a = insertSignal(db, { id: "a-sig" });
    const b = insertSignal(db, { id: "b-sig" });
    const review = (decision: string, reason: string | null, other: string | null = null) =>
      db.raw
        .prepare(
          "INSERT INTO signal_review (id,signal_id,decision,reason,contradicts_signal_id,decided_by,decided_at) VALUES (?,?,?,?,?,'u1',?)",
        )
        .run(`r${Math.random()}`, a, decision, reason, other, now);
    expect(() => review("reject", null)).toThrow();
    expect(() => review("reject", "no")).toThrow();
    expect(() => review("reject", "stale source")).not.toThrow();
    expect(() => review("contradict", null)).toThrow();
    expect(() => review("contradict", null, a)).toThrow();
    expect(() => review("contradict", null, b)).not.toThrow();
    expect(() => review("reverify", null)).toThrow();
    expect(() => db.raw.prepare("UPDATE signal_review SET reason='x'").run()).toThrow();
    expect(() => db.raw.prepare("DELETE FROM signal_review").run()).toThrow();
    expect(() =>
      db.raw
        .prepare(
          "INSERT INTO signal_contradiction (id,signal_a,signal_b,created_by,created_at) VALUES ('c',?,?,'u',?)",
        )
        .run(b, a, now),
    ).toThrow();
    db.raw
      .prepare(
        "INSERT INTO signal_contradiction (id,signal_a,signal_b,created_by,created_at) VALUES ('c',?,?,'u',?)",
      )
      .run(a, b, now);
    expect(() =>
      db.raw.prepare("UPDATE signal_contradiction SET resolved_at=?, resolved_by='u'").run(now),
    ).not.toThrow();
    expect(() => db.raw.prepare("UPDATE signal_contradiction SET resolved_by='z'").run()).toThrow();
  });
});

describe("schema scan", () => {
  it("has no column that can express funding path, fit, hypothesis, intent, buyer decision or recommendation", () => {
    const db = fresh();
    const tables = [
      "signal",
      "signal_type",
      "signal_source",
      "signal_provenance",
      "signal_tag",
      "signal_link",
      "evidence_artifact",
      "signal_review",
      "signal_contradiction",
      "taxonomy_version",
    ];
    const banned = /funding_path|(^|_)fit($|_)|hypothesis|intent|buyer_decision|recommend/;
    for (const t of tables) {
      for (const c of db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]) {
        expect(`${t}.${c.name}`).not.toMatch(banned);
      }
    }
  });
});
