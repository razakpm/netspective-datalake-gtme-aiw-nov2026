import { beforeEach, describe, expect, it } from "vitest";
import {
  ACCOUNTS,
  buildResearchHarness,
  loadPages,
  type Harness,
} from "../test-support/research-harness.js";
import type { AccountResearchSummary } from "@gtm/ai-contracts";

// Tasks T036 and T033/T034 behaviours seen through the run: the verified summary, unknowns, dropped
// findings, escalation, and the signals handed to feature 003 (quickstart V5-V8).
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
const SUMMIT = "https://www.summitcare-health.example/about";
const PROTECTED = [
  "budget",
  "buying_authority",
  "data_architecture",
  "project_status",
  "source_systems",
];
let h: Harness;
const summaryOf = (runId: string) =>
  JSON.parse(
    (
      h.db.raw.prepare("SELECT summary_json s FROM research_run WHERE id = ?").get(runId) as {
        s: string;
      }
    ).s,
  ) as AccountResearchSummary;
const signals = () =>
  h.db.raw.prepare("SELECT * FROM signal ORDER BY rowid").all() as Record<string, unknown>[];

describe("a valid run", () => {
  beforeEach(() => {
    h = buildResearchHarness({ scenario: "northvale" });
  });
  it("stores a verified summary with facts, an inference, all five protected topics as unknown, and the sources used", async () => {
    const run = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(run.state).toBe("completed");
    const s = summaryOf(run.id);
    expect(s.facts.map((f) => f.statement)).toEqual([
      "Senders submit data in three formats: CCDA, HL7 v2 and CSV extracts.",
      "Northvale published an updated implementation guide for claims attachments.",
    ]);
    expect(s.inferences).toHaveLength(1);
    expect(s.inferences[0]!.basisKeys).toHaveLength(2);
    expect(s.unknowns.map((u) => u.topic).sort()).toEqual(PROTECTED);
    expect(s.contradictions).toEqual([]);
    expect(s.sources).toHaveLength(2);
    expect(h.count("research_finding", "verified = 1")).toBe(2); // the facts; an inference rests on them
    expect(h.count("confidence_assessment", "dimension = 'extraction'")).toBe(3);
    // An inference rests on other findings and has no source of its own, so only facts carry an entity-match assessment.
    expect(h.count("confidence_assessment", "dimension = 'entity_match'")).toBe(2);
    expect(h.count("confidence_assessment", "dimension = 'source_reliability'")).toBe(3);
  });
  it("stores no page text, only fingerprints, addresses and the findings' own statements", async () => {
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const cols = (
      h.db.raw.prepare("PRAGMA table_info(research_source_fetch)").all() as { name: string }[]
    ).map((c) => c.name);
    expect(cols).not.toContain("text");
    const row = h.db.raw.prepare("SELECT * FROM research_source_fetch").get() as Record<
      string,
      unknown
    >;
    expect(row["permitted_excerpt"]).toBeNull();
    expect(String(row["content_sha256"])).toMatch(/^[0-9a-f]{64}$/);
  });
  it("hands facts and inferences to feature 003 as unreviewed AI-extracted signals that do not count as current evidence", async () => {
    const run = await h.runFor(A.northvale.id, [SENDERS, IG]);
    const rows = signals();
    expect(rows).toHaveLength(3);
    for (const r of rows) {
      expect(r).toMatchObject({
        extraction_method: "ai_extracted",
        review_status: "pending",
        created_by_type: "ai",
        account_id: A.northvale.id,
      });
      expect(r["ai_model"]).toBe("m-small");
      expect(String(r["ai_prompt_version"])).toBe("research-extract@1.0.0");
      expect(["derived_interpretation", "ai_hypothesis"]).toContain(r["evidence_status"]);
      expect(r["evidence_status"]).not.toBe("observed");
      expect(r["evidence_status"]).not.toBe("buyer_confirmed");
    }
    expect(rows.map((r) => r["evidence_status"]).sort()).toEqual([
      "ai_hypothesis",
      "derived_interpretation",
      "derived_interpretation",
    ]);
    const source = h.db.raw
      .prepare(
        "SELECT name, kind, storage_rule FROM signal_source WHERE name LIKE 'Research:%' ORDER BY name",
      )
      .all() as { name: string; kind: string; storage_rule: string }[];
    expect(source).toEqual([
      {
        name: "Research: docs.northvale-hie.example",
        kind: "official_publication",
        storage_rule: "citation_only",
      },
      {
        name: "Research: news.northvale-hie.example",
        kind: "official_publication",
        storage_rule: "citation_only",
      },
    ]);
    expect(rows.every((r) => r["reliability"] === "high")).toBe(true);
    expect(h.count("signal", "review_status = 'approved'")).toBe(0);
    const linked = h.db.raw
      .prepare("SELECT count(*) c FROM research_finding WHERE run_id = ? AND signal_id IS NOT NULL")
      .get(run.id) as { c: number };
    expect(linked.c).toBe(3);
    const ev = h.db.raw
      .prepare("SELECT payload FROM outbox_event WHERE type = 'account.researched'")
      .all() as { payload: string }[];
    expect(ev).toHaveLength(1);
    expect(JSON.parse(ev[0]!.payload)).toMatchObject({
      run_id: run.id,
      state: "completed",
      signals_created: 3,
    });
  });
  it("audits the run without any fetched or finding text", async () => {
    await h.runFor(A.northvale.id, [SENDERS, IG]);
    const dump =
      JSON.stringify(h.db.raw.prepare("SELECT * FROM audit_event").all()) +
      JSON.stringify(h.db.raw.prepare("SELECT payload FROM outbox_event").all());
    expect(dump).not.toContain("three formats");
    expect(dump).not.toContain("implementation guide");
    const actions = (
      h.db.raw.prepare("SELECT DISTINCT action FROM audit_event").all() as { action: string }[]
    ).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        "research.run.start",
        "research.summary.store",
        "research.signal.handoff",
        "research.run.complete",
      ]),
    );
  });
  it("records against the survivor when the account was merged into another", async () => {
    h.db.raw
      .prepare("UPDATE account SET merged_into = ? WHERE id = ?")
      .run(A.northvale.id, A.granite.id);
    const run = h.service.startRun(h.actor(), A.granite.id, { sources: [{ address: SENDERS }] });
    expect(run.accountId).toBe(A.northvale.id);
  });
  it("treats findings that read like conclusions as observations only and changes no decision field", async () => {
    const harness = buildResearchHarness({
      llmRules: [
        {
          task: "extraction",
          whenTextIncludes: ["Northvale HIE"],
          respond: {
            findings: [
              {
                key: "q1",
                kind: "fact",
                topic: "other",
                statement: "This organisation is a strong ICP fit and is qualified to buy.",
                supportingText: "senders submit data in three formats",
                sourceFetchId: "$BLOCK:1",
                typeKey: "org_profile_fact",
                extractionConfidence: "high",
              },
            ],
          },
        },
      ],
    });
    const before = JSON.stringify(harness.db.raw.prepare("SELECT * FROM account").all());
    const run = await harness.runFor(A.northvale.id, [SENDERS]);
    expect(run.state).toBe("completed");
    const sig = harness.db.raw
      .prepare("SELECT observation, evidence_status, review_status FROM signal")
      .get() as Record<string, string>;
    expect(sig["observation"]).toContain("strong ICP fit");
    expect(sig).toMatchObject({
      evidence_status: "derived_interpretation",
      review_status: "pending",
    });
    expect(JSON.stringify(harness.db.raw.prepare("SELECT * FROM account").all())).toBe(before);
    expect(harness.count("icp_fit_assessment")).toBe(0);
    expect(harness.count("account_hypothesis")).toBe(0);
  });
});

describe("what the verifier drops and what stays unknown", () => {
  it("drops findings citing unread sources, quotes not on the page, protected topics without a source, inferences on protected topics and unknown types, and counts each", async () => {
    h = buildResearchHarness({ scenario: "faulty-lying" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    expect(run.state).toBe("completed");
    expect(run.totals.droppedFindings).toEqual({
      uncited: 1,
      unsupported: 2,
      protectedTopic: 1,
      taxonomy: 1,
    });
    const s = summaryOf(run.id);
    expect(s.facts.map((f) => f.statement)).toEqual(["Leadership is interested in AI."]);
    expect(s.unknowns.map((u) => u.topic).sort()).toEqual(PROTECTED);
    expect(h.count("research_finding", "kind = 'fact'")).toBe(1);
    expect(h.count("signal")).toBe(1);
    expect(h.count("audit_event", "action = 'research.finding.dropped'")).toBe(1);
  });
  it("lists all five protected topics as unknown for a page that states none of them", async () => {
    h = buildResearchHarness({ scenario: "architecture-silent" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    const s = summaryOf(run.id);
    expect(s.unknowns.map((u) => u.topic).sort()).toEqual(PROTECTED);
    expect(s.facts).toHaveLength(1);
    expect(s.inferences).toEqual([]);
  });
  it("reports a contradiction citing both sources and chooses neither", async () => {
    h = buildResearchHarness({ scenario: "lakeshore" });
    const run = await h.runFor(A.lakeshore.id, [
      "https://evidence.example/lakeshore-a",
      "https://evidence.example/lakeshore-b",
    ]);
    const s = summaryOf(run.id);
    expect(s.facts).toHaveLength(2);
    expect(s.contradictions).toHaveLength(1);
    expect(new Set(s.contradictions[0]!.sourceFetchIds).size).toBe(2);
  });
  it("with no readable source completes with every topic unknown, makes no model call and proposes nothing", async () => {
    h = buildResearchHarness({ scenario: "northvale" });
    const run = await h.runFor(A.northvale.id, [
      "https://not-approved.example/a",
      "https://down.northvale-hie.example/page",
    ]);
    expect(run.state).toBe("completed");
    expect(h.llm.calls).toHaveLength(0);
    expect(
      summaryOf(run.id)
        .unknowns.map((u) => u.topic)
        .sort(),
    ).toEqual(PROTECTED);
    expect(h.count("account_hypothesis")).toBe(0);
    expect(h.count("signal")).toBe(0);
  });
});

describe("invalid model output", () => {
  it("retries up to the limit, then escalates to needs_attention keeping only the cost and attempts", async () => {
    h = buildResearchHarness({ scenario: "faulty-invalid-json" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    expect(run).toMatchObject({
      state: "needs_attention",
      stopReason: "invalid_output",
      totals: { retries: 2 },
    });
    expect(h.count("ai_invocation", "outcome = 'invalid_output'")).toBe(3);
    expect(h.count("research_finding")).toBe(0);
    expect(h.count("signal")).toBe(0);
    expect(
      h.db.raw.prepare("SELECT summary_json s FROM research_run WHERE id = ?").get(run.id),
    ).toEqual({ s: null });
    expect(Number(run.totals.cost)).toBeGreaterThan(0);
    expect(h.service.list({ state: "needs_attention" }).items.map((r) => r.id)).toEqual([run.id]);
    expect(h.count("audit_event", "action = 'research.run.attention'")).toBe(1);
    expect(h.count("outbox_event", "type = 'account.researched'")).toBe(0);
  });
  it("completes when a retry returns valid output and counts the retry", async () => {
    h = buildResearchHarness({ scenario: "faulty-invalid-then-valid" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    expect(run).toMatchObject({ state: "completed", totals: { retries: 1 } });
    expect(h.count("ai_invocation", "validation_result = 'invalid'")).toBe(1);
  });
  it("treats a provider error as an attempt and escalates after the limit", async () => {
    h = buildResearchHarness({ scenario: "faulty-provider-error" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    expect(run).toMatchObject({ state: "needs_attention", stopReason: "provider_error" });
    expect(h.count("ai_invocation", "outcome = 'provider_error'")).toBe(3);
  });
  it("lets a person acknowledge a run in needs_attention once, with a note", async () => {
    h = buildResearchHarness({ scenario: "faulty-invalid-json" });
    const run = await h.runFor(A.summitcare.id, [SUMMIT]);
    const acked = h.service.acknowledge(
      h.actor({ userId: "rev-1" }),
      run.id,
      "Looked at it; the model is misbehaving.",
    );
    expect(acked.attention).toMatchObject({
      acknowledgedBy: "rev-1",
      note: "Looked at it; the model is misbehaving.",
    });
    expect(() => h.service.acknowledge(h.actor(), run.id, "again please")).toThrow(/already/);
    expect(() => h.service.acknowledge(h.actor(), run.id, "SSN 000-12-3456")).toThrow(/PHI/);
  });
  it("refuses to acknowledge a run that is not waiting for attention", async () => {
    h = buildResearchHarness({ scenario: "northvale" });
    const run = await h.runFor(A.northvale.id, [SENDERS]);
    expect(() => h.service.acknowledge(h.actor(), run.id, "not needed")).toThrow(/not waiting/);
  });
});

describe("pages stay the same object", () => {
  it("serves fixture pages deterministically", () => {
    expect(loadPages().length).toBeGreaterThanOrEqual(9);
  });
});
