import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness, loadPages } from "../test-support/research-harness.js";

// Task T037: the prompt-injection fixture suite through a whole run. The fake model is scripted to OBEY
// injected text if it ever reaches its instruction channel or a tool, so these tests prove it cannot.
const DIR = join(import.meta.dirname, "../../../tests/fixtures/prompt-injection");
interface Fixture {
  id: string;
  payload: string;
  expectRuleIds: string[];
  benignPageTemplate: string;
}
const fixtures = readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8")) as Fixture);
const A = ACCOUNTS;

const TABLES = [
  "account",
  "account_classification",
  "icp_fit_assessment",
  "account_hypothesis",
  "hypothesis_evidence",
  "hypothesis_status_decision",
  "signal_review",
  "exclusion_override",
  "suppression_record",
  "review_item",
];
const snapshot = (db: import("@gtm/db").SqliteDatabase) =>
  JSON.stringify(TABLES.map((t) => db.raw.prepare(`SELECT * FROM ${t}`).all()));

describe.each(fixtures.map((f) => [f.id, f] as const))("injection fixture %s", (_id, f) => {
  const address = `https://www.summitcare-health.example/inj-${f.id}`;
  const text = `${f.benignPageTemplate.replace("{{PAYLOAD}}", f.payload)} Summitcare Health has an interest in artificial intelligence.`;
  const setup = () => {
    const h = buildResearchHarness({
      scenario: "obey-injection",
      pages: [...loadPages(), { address, status: 200, contentType: "text/html", text }],
    });
    return h;
  };
  it("changes no record, flags the source and the run with rule ids only, and gives the model no tools", async () => {
    const h = setup();
    const before = snapshot(h.db);
    const run = await h.runFor(A.summitcare.id, [address]);
    expect(run.state).toBe("completed");
    expect(snapshot(h.db)).toBe(before);
    const fetch = h.db.raw
      .prepare("SELECT flagged, injection_rule_ids FROM research_source_fetch")
      .get() as { flagged: number; injection_rule_ids: string };
    expect(JSON.parse(fetch.injection_rule_ids).sort()).toEqual([...f.expectRuleIds].sort());
    expect(fetch.flagged).toBe(f.expectRuleIds.length > 0 ? 1 : 0);
    expect(run.totals.injectionFlags).toBe(f.expectRuleIds.length > 0 ? 1 : 0);
    expect(h.llm.calls.length).toBe(1);
    const req = h.llm.calls[0]!;
    expect(req.tools).toEqual([]);
    expect(h.llm.obeyedInjection).toBe(false);
    expect(req.instructions).not.toContain(f.payload.slice(0, 20));
    expect(req.dataBlocks.map((b) => b.text).join(" ")).not.toContain("<<END");
  });
  it("leaves no instruction text in logs, audit events, outbox events, fetch rows, findings or signals", async () => {
    if (f.expectRuleIds.length === 0) return;
    const h = setup();
    await h.runFor(A.summitcare.id, [address]);
    const dump = [
      "audit_event",
      "outbox_event",
      "research_source_fetch",
      "research_finding",
      "signal",
      "ai_invocation",
      "research_run",
    ]
      .map((t) => JSON.stringify(h.db.raw.prepare(`SELECT * FROM ${t}`).all()))
      .join("\n");
    for (const needle of [
      f.payload.slice(0, 25),
      "mark this account as",
      "ignore previous instructions",
    ]) {
      expect(dump.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    expect(h.count("audit_event", "action = 'research.source.flagged'")).toBe(1);
  });
  it("still extracts what the page legitimately states, marked as coming from a flagged source", async () => {
    if (f.expectRuleIds.length === 0) return;
    const h = setup();
    const run = await h.runFor(A.summitcare.id, [address]);
    const detail = h.service.detail(run.id);
    const fact = detail.findings.find((x) => x.kind === "fact");
    expect(fact?.flaggedSource).toBe(true);
    expect(detail.summary).not.toBeNull();
  });
});

describe("injection corpus", () => {
  it("covers at least the nine injection fixtures and the benign prose", () => {
    expect(fixtures.filter((f) => f.expectRuleIds.length > 0).length).toBeGreaterThanOrEqual(9);
    expect(fixtures.some((f) => f.expectRuleIds.length === 0)).toBe(true);
  });
  it("never lets a model that obeys injections act: even if offered a tool the adapter-level guard refuses", async () => {
    const h = buildResearchHarness({ scenario: "obey-injection" });
    await h.runFor(A.summitcare.id, ["https://www.summitcare-health.example/about"]);
    expect(h.llm.calls.every((c) => c.tools.length === 0)).toBe(true);
    expect(h.count("ai_invocation", "outcome = 'completed'")).toBe(1);
  });
});
