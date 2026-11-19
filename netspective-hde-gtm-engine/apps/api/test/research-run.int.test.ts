import { beforeEach, describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness, type Harness } from "../test-support/research-harness.js";

// Task T025: bounded runs over fixture pages (quickstart V1-V4, V10, V19, V20).
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
let h: Harness;
beforeEach(() => {
  h = buildResearchHarness({ scenario: "northvale" });
});
const outcomes = (runId: string) =>
  (
    h.db.raw
      .prepare("SELECT outcome FROM research_source_fetch WHERE run_id = ? ORDER BY rowid")
      .all(runId) as { outcome: string }[]
  ).map((r) => r.outcome);

describe("starting a run", () => {
  it("creates a queued run with its budget and enqueues one job; a second start conflicts", () => {
    const run = h.service.startRun(h.actor(), A.northvale.id, {
      sources: [{ address: SENDERS }],
      maxSources: 5,
      maxCost: "1.50",
    });
    expect(run).toMatchObject({
      state: "queued",
      trigger: "manual",
      startedBy: "analyst-1",
      budget: { maxSources: 5, maxCost: "1.50" },
    });
    expect(h.count("job", "queue = 'research.run'")).toBe(1);
    expect(() =>
      h.service.startRun(h.actor(), A.northvale.id, { sources: [{ address: IG }] }),
    ).toThrow(/run_already_active/);
    expect(h.count("research_run")).toBe(1);
  });
  it("defaults the budget and refuses one above the per-run cap, with an audited refusal", () => {
    const run = h.service.startRun(h.actor(), A.northvale.id, { sources: [{ address: SENDERS }] });
    expect(run.budget).toEqual({ maxSources: 10, maxCost: "2.00" });
    h.service.cancel(h.actor(), run.id);
    expect(() =>
      h.service.startRun(h.actor(), A.northvale.id, {
        sources: [{ address: SENDERS }],
        maxCost: "2.01",
      }),
    ).toThrow(/max_cost_above_run_cap/);
    expect(() =>
      h.service.startRun(h.actor(), A.northvale.id, {
        sources: [{ address: SENDERS }],
        maxSources: 26,
      }),
    ).toThrow(/max_sources_above_limit/);
    expect(h.count("audit_event", "action = 'research.run.refused'")).toBe(2);
  });
  it("refuses an unknown account, an invalid address, a PHI-like capture and a non-human manual starter", () => {
    expect(() =>
      h.service.startRun(h.actor(), "nope", { sources: [{ address: SENDERS }] }),
    ).toThrow(/unknown_account/);
    expect(() =>
      h.service.startRun(h.actor(), A.northvale.id, {
        sources: [{ address: "http://x.example/" }],
      }),
    ).toThrow(/invalid_source_address/);
    const phi = (() => {
      try {
        h.service.startRun(h.actor(), A.northvale.id, {
          sources: [{ address: SENDERS, capturedText: "Patient SSN 000-12-3456 on file" }],
        });
      } catch (e) {
        return (e as Error).message;
      }
      return "";
    })();
    expect(phi).toContain("PHI");
    expect(phi).not.toContain("000-12-3456");
    expect(() =>
      h.service.startRun(h.actor({ actorType: "ai", userId: null }), A.northvale.id, {
        sources: [{ address: SENDERS }],
      }),
    ).toThrow(/Only a person/);
    expect(h.count("research_run")).toBe(0);
  });
  it("uses the account's own domains when no address is given", () => {
    const run = h.service.startRun(h.actor(), A.northvale.id, {});
    const row = h.db.raw
      .prepare("SELECT requested_sources FROM research_run WHERE id = ?")
      .get(run.id) as { requested_sources: string };
    expect(JSON.parse(row.requested_sources)).toEqual(["https://northvale-hie.example"]);
  });
});

describe("executing a run", () => {
  it("records every source, reads only approved ones and completes with cost and totals", async () => {
    const run = await h.runFor(A.northvale.id, [
      SENDERS,
      IG,
      "https://not-approved.example/page",
      "https://down.northvale-hie.example/page",
      `${SENDERS}#again`,
    ]);
    // The repeated address (the same page once the fragment is dropped) is de-duplicated at start.
    expect(outcomes(run.id)).toEqual([
      "processed",
      "processed",
      "refused_unapproved",
      "unreachable",
    ]);
    expect(h.source.fetched).not.toContain("https://not-approved.example/page");
    expect(run.state).toBe("completed");
    expect(run.totals.sourcesRead).toBe(3);
    expect(Number(run.totals.cost)).toBeGreaterThan(0);
    expect(run.totals.inputTokens).toBeGreaterThan(0);
    expect(h.count("audit_event", "action = 'research.source.refused'")).toBe(1);
  });
  it("records a redirect to an unapproved host as refused and reads nothing from it", async () => {
    const run = await h.runFor(A.northvale.id, ["https://news.northvale-hie.example/moved", IG]);
    expect(outcomes(run.id)).toEqual(["refused_redirect", "processed"]);
    expect(h.source.fetched).not.toContain("https://not-approved.example/landing");
  });
  it("records truncation of an oversize page and keeps going", async () => {
    const small = buildResearchHarness({ scenario: "northvale", settings: { maxPageBytes: 2048 } });
    const run = small.service.startRun(small.actor(), A.northvale.id, {
      sources: [{ address: "https://www.northvale-hie.example/archive" }, { address: IG }],
    });
    await small.runner.execute(run.id);
    const rows = small.db.raw
      .prepare("SELECT outcome, truncated FROM research_source_fetch ORDER BY rowid")
      .all() as { outcome: string; truncated: number }[];
    expect(rows).toEqual([
      { outcome: "too_large_truncated", truncated: 1 },
      { outcome: "processed", truncated: 0 },
    ]);
  });
  it("blocks a PHI-like page before the model, stores nothing from it and continues", async () => {
    const run = await h.runFor(A.granite.id, ["https://portal.granite-health.example/notice"]);
    expect(outcomes(run.id)).toEqual(["blocked_by_guard"]);
    expect(h.llm.calls).toHaveLength(0);
    const dump =
      JSON.stringify(h.db.raw.prepare("SELECT * FROM research_source_fetch").all()) +
      JSON.stringify(h.db.raw.prepare("SELECT * FROM audit_event").all());
    expect(dump).not.toContain("000-12-3456");
    expect(h.count("audit_event", "action = 'research.source.blocked'")).toBe(1);
    expect(run.state).toBe("completed");
  });
  it("stops before the step that would exceed the source limit and records the remaining sources", async () => {
    const run = await h.runFor(A.northvale.id, [SENDERS, IG], { maxSources: 1 });
    expect(run.state).toBe("budget_reached");
    expect(run.stopReason).toBe("max_sources");
    expect(outcomes(run.id)).toEqual(["processed", "budget_skipped"]);
    expect(
      h.db.raw.prepare("SELECT summary_json FROM research_run WHERE id = ?").get(run.id),
    ).not.toEqual({ summary_json: null });
  });
  it("stops with budget_reached when the next model call could exceed the cost cap, and never records more than the cap", async () => {
    const run = await h.runFor(A.northvale.id, [SENDERS, IG], { maxCost: "0.001" });
    expect(run.state).toBe("budget_reached");
    expect(run.stopReason).toBe("max_cost");
    expect(h.llm.calls).toHaveLength(0);
    expect(Number(run.totals.cost)).toBeLessThanOrEqual(0.001);
  });
  it("cancels before the next step and keeps the cost recorded", async () => {
    const run = h.service.startRun(h.actor(), A.northvale.id, {
      sources: [{ address: SENDERS }, { address: IG }],
    });
    h.service.cancel(h.actor(), run.id);
    await h.runner.execute(run.id);
    expect(h.service.get(run.id)).toMatchObject({ state: "cancelled", stopReason: "cancelled" });
    expect(h.count("research_source_fetch")).toBe(0);
    expect(() => h.service.cancel(h.actor(), run.id)).toThrow(/Only a queued or running/);
  });
  it("sets the excluded-ICP banner for an excluded account and changes no ICP value", async () => {
    const run = h.service.startRun(h.actor(), A.helixbio.id, {
      sources: [{ address: "https://www.helixbio.example/" }],
    });
    expect(run.icpExcluded).toBe(true);
    await h.runner.execute(run.id);
    expect(h.count("icp_fit_assessment")).toBe(0);
    expect(h.count("exclusion_override")).toBe(0);
  });
  it("is idempotent: executing a finished run again does nothing", async () => {
    const run = await h.runFor(A.northvale.id, [SENDERS]);
    const calls = h.llm.calls.length;
    await h.runner.execute(run.id);
    expect(h.llm.calls.length).toBe(calls);
  });
});
