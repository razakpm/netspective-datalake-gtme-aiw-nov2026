import { describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";

// Task T072 (SC-010): the reads that feed the workspace stay fast with a realistic account.
const A = ACCOUNTS;

describe("workspace reads", () => {
  it("answers hypotheses with evidence and the account's signals in under 2 seconds for 200 signals and 50 hypotheses", () => {
    const h = buildResearchHarness();
    const ids: string[] = [];
    for (let i = 0; i < 200; i++) {
      ids.push(
        h.signal(
          A.northvale.id,
          `Observation number ${i} about topic ${(i * 7919).toString(36)} for the account.`,
          {
            source: { name: `Perf source ${i}`, kind: "other", ref: `https://example.org/p/${i}` },
          },
        ).id,
      );
    }
    for (let i = 0; i < 50; i++) {
      h.hypotheses.create(h.actor(), A.northvale.id, {
        statement: `Testable statement number ${i} about sender onboarding may hold.`,
        category: "onboarding_friction",
        supportingSignalIds: ids.slice(i, i + 4),
        confidence: { band: "low", explanation: "Performance fixture." },
      });
    }
    const start = performance.now();
    const list = h.hypotheses.list(A.northvale.id, { limit: 50 });
    for (const item of list.items) h.hypotheses.get(item.id);
    const signals = h.signals.get(ids[0]!);
    expect(performance.now() - start).toBeLessThan(2000);
    expect(list.items).toHaveLength(50);
    expect(signals.id).toBe(ids[0]);
  });
  it("composes the account summary for 25 sources and 200 findings in under 1 second", () => {
    const h = buildResearchHarness();
    const at = "2026-11-19T10:00:00.000Z";
    h.db.raw
      .prepare(
        "INSERT INTO research_run (id, account_id, started_by, trigger, state, max_sources, max_cost_micros, summary_json, created_at) VALUES ('rp', ?, 'u','manual','completed',25,2000000,'{}',?)",
      )
      .run(A.northvale.id, at);
    const facts: { key: string; carriedOver: boolean }[] = [];
    const sources: { fetchId: string; flagged: boolean }[] = [];
    for (let s = 0; s < 25; s++) {
      h.db.raw
        .prepare(
          "INSERT INTO research_source_fetch (id, run_id, address, address_normalised, outcome, fetched_at) VALUES (?,?,?,?, 'processed', ?)",
        )
        .run(`f${s}`, "rp", `https://x.example/${s}`, `https://x.example/${s}`, at);
      sources.push({ fetchId: `f${s}`, flagged: false });
      for (let k = 0; k < 8; k++) {
        const id = `fd-${s}-${k}`;
        h.db.raw
          .prepare(
            "INSERT INTO research_finding (id, run_id, fetch_id, kind, topic, statement, supporting_text_sha256, extraction_confidence, verified, created_at) VALUES (?,?,?,'fact','other',?,?, 'medium',1,?)",
          )
          .run(id, "rp", `f${s}`, `Finding ${s}-${k}`, "h", at);
        facts.push({ key: id, carriedOver: false });
      }
    }
    h.db.raw
      .prepare("UPDATE research_run SET summary_json = ? WHERE id = 'rp'")
      .run(JSON.stringify({ facts, inferences: [], unknowns: [], contradictions: [], sources }));
    const start = performance.now();
    const summary = h.service.accountSummary(A.northvale.id);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(summary.facts).toHaveLength(200);
    expect(summary.sources).toHaveLength(25);
  });
});
