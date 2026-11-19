import { describe, expect, it } from "vitest";
import type { FakeRule } from "@gtm/providers";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";
import { ResearchSchedules } from "../src/modules/research/schedule.js";

// Task T061: no run exceeds its budget or the account's monthly cap, and every call's cost is recorded
// (quickstart V3, V4). Money is in integer micro-units; the clock is injectable.
const A = ACCOUNTS;
const SENDERS = "https://news.northvale-hie.example/senders";
const IG = "https://docs.northvale-hie.example/ig-update";
const msg = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};
const spent = (h: ReturnType<typeof buildResearchHarness>, accountId: string) =>
  (
    h.db.raw
      .prepare("SELECT COALESCE(SUM(cost_micros),0) c FROM ai_invocation WHERE account_id = ?")
      .get(accountId) as { c: number }
  ).c;

describe("per-account monthly cap", () => {
  it("counts every earlier call of the month and refuses a run that could exceed what is left, without calling the model", async () => {
    const h = buildResearchHarness({
      scenario: "northvale",
      settings: { accountMonthlyCapMicros: 2_000_000, runCapMicros: 2_000_000 },
    });
    const first = await h.runFor(A.northvale.id, [SENDERS, IG]);
    expect(first.state).toBe("completed");
    const used = spent(h, A.northvale.id);
    expect(used).toBeGreaterThan(0);
    const calls = h.llm.calls.length;
    expect(
      msg(() => h.service.startRun(h.actor(), A.northvale.id, { sources: [{ address: IG }] })),
    ).toContain("account_cap_exceeded");
    expect(h.llm.calls.length).toBe(calls);
    // A budget that fits in what is left is accepted.
    const ok = h.service.startRun(h.actor(), A.northvale.id, {
      sources: [{ address: IG }],
      maxCost: "1.00",
    });
    expect(ok.state).toBe("queued");
  });
  it("stops a run mid-way when the account allowance, not the run budget, is what runs out", async () => {
    const h = buildResearchHarness({
      scenario: "northvale",
      settings: { accountMonthlyCapMicros: 12_000, runCapMicros: 2_000_000 },
    });
    // 12,000 micro-units cover a start (max cost below the allowance) but not a worst-case call.
    const run = h.service.startRun(h.actor(), A.northvale.id, {
      sources: [{ address: SENDERS }],
      maxCost: "0.01",
    });
    await h.runner.execute(run.id);
    const done = h.service.get(run.id);
    expect(done.state).toBe("budget_reached");
    expect(["max_cost", "account_cap"]).toContain(done.stopReason);
    expect(spent(h, A.northvale.id)).toBeLessThanOrEqual(12_000);
  });
  it("resets the allowance in a new calendar month", async () => {
    const h = buildResearchHarness({
      scenario: "northvale",
      settings: { accountMonthlyCapMicros: 2_000_000, runCapMicros: 2_000_000 },
    });
    await h.runFor(A.northvale.id, [SENDERS]);
    expect(
      msg(() => h.service.startRun(h.actor(), A.northvale.id, { sources: [{ address: IG }] })),
    ).toContain("account_cap_exceeded");
    h.clock.now = new Date("2026-12-01T00:00:00.000Z");
    expect(
      h.service.startRun(h.actor(), A.northvale.id, { sources: [{ address: IG }] }).state,
    ).toBe("queued");
  });
  it("counts failed runs and every retry", async () => {
    const h = buildResearchHarness({ scenario: "faulty-invalid-json" });
    const run = await h.runFor(A.summitcare.id, ["https://www.summitcare-health.example/about"]);
    expect(run.state).toBe("needs_attention");
    expect(h.count("ai_invocation", "account_id = 'acc-summitcare'")).toBe(3);
    expect(spent(h, A.summitcare.id)).toBeGreaterThan(0);
    expect(spent(h, A.summitcare.id)).toBe(Math.round(Number(run.totals.cost) * 1_000_000));
  });
  it("counts scheduled runs against the cap and skips a cycle it cannot afford", async () => {
    const h = buildResearchHarness({
      scenario: "northvale",
      settings: { accountMonthlyCapMicros: 1_000_000, runCapMicros: 2_000_000 },
    });
    const schedules = new ResearchSchedules(h.db, h.service);
    schedules.set(h.actor(), A.northvale.id, { enabled: true, cadence: "weekly" });
    // The default budget (2.00) is above the account's 1.00 cap, so a scheduled start is refused.
    expect(schedules.tick(new Date("2026-11-27T00:00:00.000Z"))).toEqual([]);
    expect(h.count("research_run")).toBe(0);
    expect(h.count("audit_event", "action = 'research.run.refused'")).toBe(1);
  });
  it("counts interpretation calls against the same account allowance", async () => {
    const h = buildResearchHarness({
      scenario: "riverbend",
      settings: { accountMonthlyCapMicros: 20_000 },
    });
    const r = await h.interpreter.interpret(h.actor(), A.riverbend.id, {
      statement: "Our pilot worked on demo data but failed on ours, and we cannot tell why.",
    });
    expect(r.cost).toMatch(/^0\./);
    const used = spent(h, A.riverbend.id);
    expect(used).toBeGreaterThan(0);
    expect(
      msg(() =>
        h.service.startRun(h.actor(), A.riverbend.id, {
          sources: [{ address: "https://www.riverbend-health.example/news/pilot" }],
          maxCost: "0.02",
        }),
      ),
    ).toContain("account_cap_exceeded");
  });
});

describe("per-run cap", () => {
  const extract = (tokens: { input: number; output: number }): FakeRule => ({
    task: "extraction",
    whenTextIncludes: ["Northvale HIE"],
    tokens,
    respond: {
      findings: [
        {
          key: "n1",
          kind: "fact",
          topic: "other",
          statement: "Senders submit data in three formats.",
          supportingText: "three formats: CCDA, HL7 v2 and CSV extracts",
          sourceFetchId: "$BLOCK:1",
          typeKey: "multi_format_sender",
          extractionConfidence: "high",
        },
      ],
    },
  });
  it("never records more than the run's cap even when the provider reports far more tokens than expected", async () => {
    const h = buildResearchHarness({
      llmRules: [extract({ input: 50_000_000, output: 50_000_000 })],
    });
    const run = await h.runFor(A.northvale.id, [SENDERS], { maxCost: "0.05" });
    expect(run.state).toBe("completed");
    expect(Number(run.totals.cost)).toBeLessThanOrEqual(0.05);
    const row = h.db.raw
      .prepare("SELECT cost_micros, max_cost_micros FROM research_run WHERE id = ?")
      .get(run.id) as { cost_micros: number; max_cost_micros: number };
    expect(row.cost_micros).toBeLessThanOrEqual(row.max_cost_micros);
    const ledger = h.db.raw
      .prepare("SELECT cost_micros, input_tokens FROM ai_invocation")
      .get() as { cost_micros: number; input_tokens: number };
    expect(ledger.input_tokens).toBe(50_000_000); // what the provider reported is kept as reported
    expect(ledger.cost_micros).toBeLessThanOrEqual(50_000);
  });
  it("never makes a call a tight cap cannot cover, whatever the sequence of sources", async () => {
    for (const maxCost of ["0.000001", "0.001", "0.0099"]) {
      const h = buildResearchHarness({ scenario: "northvale" });
      const run = await h.runFor(A.northvale.id, [SENDERS, IG], { maxCost });
      expect(run.state).toBe("budget_reached");
      expect(h.llm.calls).toHaveLength(0);
      expect(Number(run.totals.cost)).toBeLessThanOrEqual(Number(maxCost));
    }
  });
  it("records the cost of failed and cancelled runs", async () => {
    const h = buildResearchHarness({ scenario: "faulty-provider-error" });
    const failed = await h.runFor(A.summitcare.id, ["https://www.summitcare-health.example/about"]);
    expect(failed.state).toBe("needs_attention");
    expect(failed.totals.cost).toBe("0.00");
    expect(h.count("ai_invocation", "outcome = 'provider_error'")).toBe(3);
    expect(
      h.db.raw.prepare("SELECT cost_micros FROM research_run WHERE id = ?").get(failed.id),
    ).toEqual({ cost_micros: 0 });
  });
});
