import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import {
  accountSpendMicros,
  activeRunFor,
  latestProcessedFetch,
  listEnabledRules,
} from "../src/modules/research/repository.js";

// Task T014: repository reads (one active run, the cache lookup, the account spend sum).
const now = "2026-11-19T10:00:00.000Z";
function setup() {
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
const run = (db: SqliteDatabase, id: string, state: string) =>
  db.raw
    .prepare(
      "INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros, summary_json, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(id, "a1", "u1", "manual", state, 10, 2_000_000, state === "completed" ? "{}" : null, now);

describe("research repository", () => {
  it("finds the one active run and the latest processed fetch of an address across runs", () => {
    const db = setup();
    run(db, "r1", "completed");
    run(db, "r2", "running");
    expect(db.transaction((tx) => activeRunFor(tx, "a1"))?.id).toBe("r2");
    const fetch = (id: string, runId: string, outcome: string, at: string, sha: string) =>
      db.raw
        .prepare(
          "INSERT INTO research_source_fetch (id, run_id, address, address_normalised, outcome, content_sha256, fetched_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(id, runId, "https://x.example/p", "https://x.example/p", outcome, sha, at);
    fetch("f1", "r1", "processed", "2026-11-01T00:00:00.000Z", "aaa");
    fetch("f2", "r2", "unchanged_skipped", "2026-11-10T00:00:00.000Z", "aaa");
    fetch("f3", "r2", "processed", "2026-11-12T00:00:00.000Z", "bbb");
    expect(
      db.transaction((tx) => latestProcessedFetch(tx, "a1", "https://x.example/p"))?.content_sha256,
    ).toBe("bbb");
    expect(
      db.transaction((tx) => latestProcessedFetch(tx, "a1", "https://other.example/")),
    ).toBeUndefined();
  });
  it("lists only enabled rules and sums the month's spend from the account's model calls", () => {
    const db = setup();
    const rule = (id: string, status: string) =>
      db.raw
        .prepare(
          "INSERT INTO research_source_rule (id, kind, match_type, pattern, status, signal_source_kind, created_at) VALUES (?,?,?,?,?,?,?)",
        )
        .run(id, "public_org_site", "host", `${id}.example`, status, "official_publication", now);
    rule("on-rule", "enabled");
    rule("off-rule", "disabled");
    expect(db.transaction((tx) => listEnabledRules(tx)).map((r) => r.id)).toEqual(["on-rule"]);
    run(db, "r1", "completed");
    const inv = (id: string, at: string, cost: number) =>
      db.raw
        .prepare(
          "INSERT INTO ai_invocation (id, occurred_at, provider, model, task, prompt_version_id, schema_version, context_type, context_id, account_id, attempt, input_tokens, output_tokens, cost_micros, latency_ms, validation_result, outcome, actor_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          at,
          "fake",
          "m",
          "extraction",
          "prompt-research-extract-1.0.0",
          "1",
          "research_run",
          "r1",
          "a1",
          1,
          1,
          1,
          cost,
          1,
          "valid",
          "completed",
          "ai",
        );
    inv("i1", "2026-10-31T23:59:59.000Z", 500);
    inv("i2", "2026-11-05T00:00:00.000Z", 1200);
    inv("i3", "2026-11-06T00:00:00.000Z", 300);
    db.raw
      .prepare(
        "INSERT INTO prompt_version (id, name, version, template_hash, output_schema_id, output_schema_version, status) VALUES ('pv','x','1','h','s','1','approved')",
      )
      .run();
    db.raw
      .prepare(
        "INSERT INTO problem_interpretation (id, account_id, statement_sha256, matches_json, questions_json, unknowns_json, ai_model, ai_prompt_version_id, requested_by, cost_micros, created_at) VALUES ('pi','a1','h','[]','[]','[]','m','pv','u1',700,?)",
      )
      .run("2026-11-07T00:00:00.000Z");
    expect(db.transaction((tx) => accountSpendMicros(tx, "a1", "2026-11-01T00:00:00.000Z"))).toBe(
      1500,
    );
  });
});
