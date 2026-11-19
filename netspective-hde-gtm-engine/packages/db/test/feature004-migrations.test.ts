import { describe, expect, it } from "vitest";
import { migrate, seedReference, SqliteDatabase } from "../src/index.js";

// Migrations 0014-0016 (feature 004): constraints, triggers and the schema scan (tasks T008, T013).
const now = "2026-11-19T00:00:00.000Z";
type V = string | number | null;
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
const insert = (db: SqliteDatabase, table: string, row: Record<string, V>) => {
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...Object.values(row));
};
const run = (db: SqliteDatabase, over: Record<string, V> = {}) =>
  insert(db, "research_run", {
    id: `run-${Math.random()}`,
    account_id: "a1",
    started_by: "u1",
    trigger: "manual",
    state: "queued",
    max_sources: 10,
    max_cost_micros: 2_000_000,
    created_at: now,
    ...over,
  });
const signal = (db: SqliteDatabase, id: string, over: Record<string, V> = {}) =>
  insert(db, "signal", {
    id,
    account_id: "a1",
    type_key: "program_announcement",
    taxonomy_version: 1,
    source_id: "default-source-official_publication",
    source_ref: "r",
    source_ref_normalised: "r",
    observation: `o-${id}`,
    observed_at: now,
    collected_at: now,
    reliability: "high",
    extraction_method: "manual",
    extraction_confidence: "high",
    evidence_status: "observed",
    freshness_days: 90,
    fresh_until: "2027-03-01T00:00:00.000Z",
    retention_policy: "business_record",
    retain_until: "2030-01-01T00:00:00.000Z",
    sensitivity: "public",
    content_fingerprint: `fp-${id}`,
    created_by_type: "human",
    created_at: now,
    updated_at: now,
    ...over,
  });
const hyp = (db: SqliteDatabase, id: string, over: Record<string, V> = {}) =>
  insert(db, "account_hypothesis", {
    id,
    account_id: "a1",
    origin: "analyst",
    acceptance: "accepted",
    statement: "A testable statement about intake.",
    category: "onboarding_friction",
    status: "untested",
    confidence_band: "low",
    confidence_explanation: "Little evidence so far.",
    created_by: "u1",
    created_at: now,
    updated_at: now,
    ...over,
  });

describe("seed", () => {
  it("seeds categories, capabilities and approved prompt versions idempotently", () => {
    const db = fresh();
    const count = (t: string) =>
      (db.raw.prepare(`SELECT count(*) c FROM ${t}`).get() as { c: number }).c;
    expect(count("hypothesis_category")).toBe(7);
    expect(count("service_capability_provisional")).toBe(10);
    expect(count("prompt_version")).toBe(3);
    expect(
      (
        db.raw.prepare("SELECT count(*) c FROM prompt_version WHERE status = 'approved'").get() as {
          c: number;
        }
      ).c,
    ).toBe(3);
    db.transaction((tx) => seedReference(tx));
    expect(count("prompt_version")).toBe(3);
  });
});

describe("0014 ai invocation ledger", () => {
  it("is append-only and has no content column", () => {
    const db = fresh();
    insert(db, "ai_invocation", {
      id: "i1",
      occurred_at: now,
      provider: "fake",
      model: "m",
      task: "extraction",
      prompt_version_id: "prompt-research-extract-1.0.0",
      schema_version: "1.0.0",
      context_type: "other",
      attempt: 1,
      input_tokens: 1,
      output_tokens: 1,
      cost_micros: 1,
      latency_ms: 1,
      validation_result: "valid",
      outcome: "completed",
      actor_type: "ai",
    });
    expect(() => db.raw.prepare("UPDATE ai_invocation SET cost_micros = 0").run()).toThrow();
    expect(() => db.raw.prepare("DELETE FROM ai_invocation").run()).toThrow();
    const cols = (
      db.raw.prepare("PRAGMA table_info(ai_invocation)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols.some((c) => /prompt_body|response|reasoning|^content$|_text$|^text$/.test(c))).toBe(
      false,
    );
    expect(() =>
      insert(db, "ai_invocation", {
        id: "i2",
        occurred_at: now,
        provider: "other",
        model: "m",
        task: "extraction",
        prompt_version_id: "prompt-research-extract-1.0.0",
        schema_version: "1",
        context_type: "other",
        attempt: 1,
        input_tokens: 0,
        output_tokens: 0,
        cost_micros: 0,
        latency_ms: 0,
        validation_result: "valid",
        outcome: "completed",
        actor_type: "ai",
      }),
    ).toThrow();
  });
});

describe("0015 research", () => {
  it("allows one active run per account and bounds budgets and cost", () => {
    const db = fresh();
    run(db, { id: "r1", state: "running" });
    expect(() => run(db, { state: "queued" })).toThrow();
    db.raw.prepare("UPDATE research_run SET state = 'cancelled' WHERE id = 'r1'").run();
    expect(() => run(db)).not.toThrow();
    expect(() => run(db, { account_id: "a1", state: "completed", max_sources: 26 })).toThrow();
    expect(() => run(db, { state: "failed", max_cost_micros: 100, cost_micros: 101 })).toThrow();
    expect(() => run(db, { state: "failed", max_sources: 0 })).toThrow();
  });
  it("needs a summary for completed and budget_reached runs only", () => {
    const db = fresh();
    expect(() => run(db, { state: "completed" })).toThrow();
    expect(() => run(db, { state: "budget_reached" })).toThrow();
    expect(() => run(db, { state: "completed", summary_json: "{}" })).not.toThrow();
    expect(() => run(db, { state: "needs_attention" })).not.toThrow();
  });
  it("guards source rules and fetch outcomes, and keeps rules", () => {
    const db = fresh();
    const rule = (over: Record<string, V>) =>
      insert(db, "research_source_rule", {
        id: `rule-${Math.random()}`,
        kind: "public_org_site",
        match_type: "host",
        pattern: "www.northvale-hie.example",
        status: "enabled",
        signal_source_kind: "official_publication",
        created_at: now,
        ...over,
      });
    expect(() => rule({})).not.toThrow();
    expect(() => rule({ id: "dup" })).toThrow();
    expect(() => rule({ pattern: "Bad Pattern!" })).toThrow();
    expect(() => rule({ pattern: "ab" })).toThrow();
    expect(() => db.raw.prepare("DELETE FROM research_source_rule").run()).toThrow();
    run(db, { id: "r1", state: "running" });
    const fetch = (outcome: string) =>
      insert(db, "research_source_fetch", {
        id: `f-${Math.random()}`,
        run_id: "r1",
        address: "https://x.example/",
        address_normalised: "https://x.example",
        outcome,
        fetched_at: now,
      });
    expect(() => fetch("processed")).not.toThrow();
    expect(() => fetch("unchanged_skipped")).not.toThrow();
    expect(() => fetch("something_else")).toThrow();
    const cols = (
      db.raw.prepare("PRAGMA table_info(research_source_fetch)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols.some((c) => /page_text|full_text|body|content$/.test(c))).toBe(false);
  });
  it("requires a verified fact on protected topics and a source for non-unknown findings", () => {
    const db = fresh();
    run(db, { id: "r1", state: "running" });
    insert(db, "research_source_fetch", {
      id: "f1",
      run_id: "r1",
      address: "https://x.example/",
      address_normalised: "https://x.example",
      outcome: "processed",
      fetched_at: now,
    });
    const finding = (over: Record<string, V>) =>
      insert(db, "research_finding", {
        id: `fd-${Math.random()}`,
        run_id: "r1",
        fetch_id: "f1",
        kind: "fact",
        topic: "other",
        statement: "s",
        extraction_confidence: "high",
        verified: 1,
        supporting_text_sha256: "h",
        created_at: now,
        ...over,
      });
    expect(() => finding({})).not.toThrow();
    expect(() => finding({ topic: "budget", verified: 0, supporting_text_sha256: null })).toThrow();
    expect(() => finding({ topic: "budget" })).not.toThrow();
    expect(() => finding({ fetch_id: null })).toThrow();
    expect(() =>
      finding({
        kind: "unknown",
        fetch_id: null,
        topic: "budget",
        verified: 0,
        supporting_text_sha256: null,
      }),
    ).not.toThrow();
    expect(() => finding({ statement: "x".repeat(501) })).toThrow();
    expect(() => finding({ supporting_text: "x".repeat(241) })).toThrow();
  });
});

describe("0016 hypotheses", () => {
  it("ties status to acceptance and requires AI proposals to carry their provenance", () => {
    const db = fresh();
    expect(() => hyp(db, "h1")).not.toThrow();
    expect(() => hyp(db, "h2", { acceptance: "proposed" })).toThrow(); // status set but not accepted
    expect(() => hyp(db, "h3", { acceptance: "accepted", status: null })).toThrow();
    run(db, { id: "r1", state: "completed", summary_json: "{}" });
    expect(() =>
      hyp(db, "h4", { origin: "ai", acceptance: "proposed", status: null, created_by: null }),
    ).toThrow();
    expect(() =>
      hyp(db, "h5", {
        origin: "ai",
        acceptance: "proposed",
        status: null,
        created_by: null,
        ai_model: "m",
        ai_prompt_version_id: "prompt-hypothesis-propose-1.0.0",
        proposed_by_run_id: "r1",
      }),
    ).not.toThrow();
    expect(() =>
      hyp(db, "h6", { origin: "analyst", acceptance: "proposed", status: null }),
    ).toThrow();
    expect(() => hyp(db, "h7", { statement: "short" })).toThrow();
    expect(() => hyp(db, "h8", { category: "unknown_category" })).toThrow();
    expect(() => hyp(db, "h9", { confidence_band: "0.9" })).toThrow();
    const cols = (
      db.raw.prepare("PRAGMA table_info(account_hypothesis)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols.some((c) => /score|qualif|funding|budget|eligib|icp_fit/.test(c))).toBe(false);
  });
  it("keeps evidence, assumptions, decisions and assessments append-only", () => {
    const db = fresh();
    hyp(db, "h1");
    signal(db, "s1");
    insert(db, "hypothesis_evidence", {
      id: "e1",
      hypothesis_id: "h1",
      signal_id: "s1",
      role: "supporting",
      linked_by_type: "human",
      linked_at: now,
    });
    expect(() =>
      insert(db, "hypothesis_evidence", {
        id: "e2",
        hypothesis_id: "h1",
        signal_id: "s1",
        role: "contradictory",
        linked_by_type: "human",
        linked_at: now,
      }),
    ).toThrow();
    expect(() =>
      db.raw.prepare("UPDATE hypothesis_evidence SET role = 'contradictory'").run(),
    ).toThrow();
    expect(() => db.raw.prepare("DELETE FROM hypothesis_evidence").run()).toThrow();
    insert(db, "hypothesis_assumption", {
      id: "a1",
      hypothesis_id: "h1",
      text: "An assumption",
      source: "analyst",
      added_by: "u1",
      added_at: now,
    });
    expect(() => db.raw.prepare("DELETE FROM hypothesis_assumption").run()).toThrow();
    expect(() =>
      insert(db, "hypothesis_assumption", {
        id: "a2",
        hypothesis_id: "h1",
        text: "ab",
        source: "analyst",
        added_by: "u1",
        added_at: now,
      }),
    ).toThrow();
    insert(db, "confidence_assessment", {
      id: "c1",
      subject_type: "finding",
      subject_id: "x",
      dimension: "extraction",
      band: "low",
      explanation: "weak",
      assessed_by_type: "ai",
      assessed_at: now,
    });
    expect(() => db.raw.prepare("UPDATE confidence_assessment SET band = 'high'").run()).toThrow();
    expect(() =>
      insert(db, "confidence_assessment", {
        id: "c2",
        subject_type: "finding",
        subject_id: "x",
        dimension: "extraction",
        band: "0.8",
        explanation: "weak",
        assessed_by_type: "ai",
        assessed_at: now,
      }),
    ).toThrow();
  });
  it("allows a system decision only for stale and needs a note for every decision", () => {
    const db = fresh();
    hyp(db, "h1");
    const decision = (over: Record<string, V>) =>
      insert(db, "hypothesis_status_decision", {
        id: `d-${Math.random()}`,
        hypothesis_id: "h1",
        from_status: "untested",
        to_status: "strengthening",
        note: "reviewed the evidence",
        decided_by: "rev1",
        decided_by_type: "human",
        decided_at: now,
        ...over,
      });
    expect(() => decision({})).not.toThrow();
    expect(() => decision({ note: "ab" })).toThrow();
    expect(() => decision({ decided_by_type: "system", decided_by: null })).toThrow();
    expect(() =>
      decision({
        decided_by_type: "system",
        decided_by: null,
        to_status: "stale",
        reason_code: "no_current_evidence",
      }),
    ).not.toThrow();
    expect(() => decision({ decided_by: null })).toThrow();
    expect(() =>
      db.raw.prepare("UPDATE hypothesis_status_decision SET note = 'changed note'").run(),
    ).toThrow();
    expect(() => db.raw.prepare("DELETE FROM hypothesis_status_decision").run()).toThrow();
  });
  it("lets the database refuse validated without a supporting approved buyer-confirmed signal", () => {
    const db = fresh();
    hyp(db, "h1");
    const validate = () =>
      insert(db, "hypothesis_status_decision", {
        id: `d-${Math.random()}`,
        hypothesis_id: "h1",
        from_status: "strengthening",
        to_status: "validated",
        note: "buyer confirmed it",
        decided_by: "rev1",
        decided_by_type: "human",
        decided_at: now,
      });
    expect(validate).toThrow();
    signal(db, "s1", { evidence_status: "observed", review_status: "approved" });
    insert(db, "hypothesis_evidence", {
      id: "e1",
      hypothesis_id: "h1",
      signal_id: "s1",
      role: "supporting",
      linked_by_type: "human",
      linked_at: now,
    });
    expect(validate).toThrow(); // approved but only observed
    signal(db, "s2", {
      evidence_status: "buyer_confirmed",
      source_id: "default-source-buyer_statement",
      review_status: "pending",
    });
    insert(db, "hypothesis_evidence", {
      id: "e2",
      hypothesis_id: "h1",
      signal_id: "s2",
      role: "supporting",
      linked_by_type: "human",
      linked_at: now,
    });
    expect(validate).toThrow(); // buyer-confirmed but not approved
    db.raw.prepare("UPDATE signal SET review_status = 'approved' WHERE id = 's2'").run();
    expect(validate).not.toThrow();
    // A contradictory link of a buyer-confirmed signal does not count.
    hyp(db, "h2");
    signal(db, "s3", {
      evidence_status: "buyer_confirmed",
      review_status: "approved",
      source_id: "default-source-buyer_statement",
    });
    insert(db, "hypothesis_evidence", {
      id: "e3",
      hypothesis_id: "h2",
      signal_id: "s3",
      role: "contradictory",
      linked_by_type: "human",
      linked_at: now,
    });
    expect(() =>
      insert(db, "hypothesis_status_decision", {
        id: "d-x",
        hypothesis_id: "h2",
        from_status: "untested",
        to_status: "validated",
        note: "not on contradictory",
        decided_by: "rev1",
        decided_by_type: "human",
        decided_at: now,
      }),
    ).toThrow();
  });
});

describe("schema scan", () => {
  it("has no column that can hold a prompt, a response, reasoning, page text or a numeric confidence", () => {
    const db = fresh();
    const tables = [
      "prompt_version",
      "ai_invocation",
      "research_source_rule",
      "research_run",
      "research_source_fetch",
      "research_finding",
      "research_schedule",
      "hypothesis_category",
      "service_capability_provisional",
      "account_hypothesis",
      "hypothesis_tag",
      "hypothesis_evidence",
      "hypothesis_assumption",
      "hypothesis_status_decision",
      "confidence_assessment",
      "problem_interpretation",
    ];
    const banned =
      /prompt_body|response_body|reasoning|chain_of_thought|page_text|full_text|confidence_score|qualification|funding_path|budget_amount|eligib|icp_fit|statement_text/;
    for (const t of tables) {
      for (const c of db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]) {
        expect(`${t}.${c.name}`).not.toMatch(banned);
      }
    }
  });
});
