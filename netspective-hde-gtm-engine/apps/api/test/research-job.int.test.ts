import { describe, expect, it } from "vitest";
import { ACCOUNTS, buildResearchHarness } from "../test-support/research-harness.js";
import { HandlerRegistry } from "../src/worker/registry.js";
import { registerResearchHandlers } from "../src/worker/research-handlers.js";
import { ResearchSchedules } from "../src/modules/research/schedule.js";
import { Worker } from "../src/worker/bootstrap.js";
import pino from "pino";

// Tasks T029 and T030: the run job, a re-delivered job, and the simple schedule.
const SENDERS = "https://news.northvale-hie.example/senders";

function wire() {
  const h = buildResearchHarness({ scenario: "northvale" });
  const registry = new HandlerRegistry();
  const schedules = new ResearchSchedules(h.db, h.service);
  registerResearchHandlers(registry, { runner: h.runner, schedules });
  const worker = new Worker({ service: h.jobs, registry, logger: pino({ level: "silent" }) });
  return { h, registry, schedules, worker };
}

describe("research.run job", () => {
  it("executes a queued run through the job service and completes the job", async () => {
    const { h, worker } = wire();
    const run = h.service.startRun(h.actor(), ACCOUNTS.northvale.id, {
      sources: [{ address: SENDERS }],
    });
    expect(await worker.runOnce()).toBe(1);
    expect(h.service.get(run.id).state).toBe("completed");
    const job = h.db.raw.prepare("SELECT state FROM job WHERE queue = 'research.run'").get() as {
      state: string;
    };
    expect(job.state).toBe("succeeded");
  });
  it("is a no-op when the job is delivered again after the run finished", async () => {
    const { h, registry } = wire();
    const run = h.service.startRun(h.actor(), ACCOUNTS.northvale.id, {
      sources: [{ address: SENDERS }],
    });
    await h.runner.execute(run.id);
    const calls = h.llm.calls.length;
    await registry.get("research.run")!({
      id: "j",
      payload: { runId: run.id, captured: {} },
    } as never);
    expect(h.llm.calls.length).toBe(calls);
    expect(h.count("research_source_fetch")).toBe(1);
  });
  it("carries analyst-pasted text in the job payload and never makes a network call for it", async () => {
    const { h, worker } = wire();
    const address = "https://news.northvale-hie.example/pasted";
    h.service.startRun(h.actor(), ACCOUNTS.northvale.id, {
      sources: [
        {
          address,
          capturedText:
            "Northvale HIE reports that senders submit data in three formats: CCDA, HL7 v2 and CSV extracts.",
        },
      ],
    });
    await worker.runOnce();
    expect(h.source.fetched).toEqual([]);
    expect(h.count("signal")).toBe(1);
  });
});

describe("research schedule", () => {
  it("is created for a chosen account only, audited, and runs when due and then moves on", async () => {
    const { h, schedules } = wire();
    expect(schedules.get(ACCOUNTS.northvale.id)).toEqual({
      accountId: ACCOUNTS.northvale.id,
      enabled: false,
      cadence: null,
      nextRunAt: null,
    });
    expect(() => schedules.set(h.actor(), ACCOUNTS.northvale.id, { enabled: true })).toThrow(
      /cadence is required/,
    );
    const set = schedules.set(h.actor(), ACCOUNTS.northvale.id, {
      enabled: true,
      cadence: "weekly",
    });
    expect(set).toMatchObject({ enabled: true, cadence: "weekly" });
    expect(set.nextRunAt).toBe("2026-11-26T10:00:00.000Z");
    expect(h.count("audit_event", "action = 'research.schedule.set'")).toBe(1);
    expect(schedules.tick(new Date("2026-11-20T00:00:00.000Z"))).toEqual([]);
    const started = schedules.tick(new Date("2026-11-26T10:00:00.000Z"));
    expect(started).toHaveLength(1);
    expect(h.service.get(started[0]!)).toMatchObject({
      trigger: "schedule",
      accountId: ACCOUNTS.northvale.id,
    });
    expect(schedules.get(ACCOUNTS.northvale.id).nextRunAt).toBe("2026-12-03T10:00:00.000Z");
    expect(h.count("research_schedule")).toBe(1);
  });
  it("skips a cycle when a run is already active and advances anyway", () => {
    const { h, schedules } = wire();
    schedules.set(h.actor(), ACCOUNTS.northvale.id, { enabled: true, cadence: "monthly" });
    h.service.startRun(h.actor(), ACCOUNTS.northvale.id, { sources: [{ address: SENDERS }] });
    expect(schedules.tick(new Date("2026-12-25T00:00:00.000Z"))).toEqual([]);
    expect(h.count("research_run")).toBe(1);
    expect(schedules.get(ACCOUNTS.northvale.id).nextRunAt).toBe("2027-01-25T00:00:00.000Z");
  });
  it("can be turned off, and an unknown account is refused", () => {
    const { h, schedules } = wire();
    schedules.set(h.actor(), ACCOUNTS.northvale.id, { enabled: true, cadence: "weekly" });
    expect(schedules.set(h.actor(), ACCOUNTS.northvale.id, { enabled: false })).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    expect(schedules.tick(new Date("2027-01-01T00:00:00.000Z"))).toEqual([]);
    expect(() => schedules.set(h.actor(), "nope", { enabled: true, cadence: "weekly" })).toThrow(
      /No such account/,
    );
  });
  it("never schedules an account nobody chose", () => {
    const { h, schedules } = wire();
    expect(schedules.tick(new Date("2030-01-01T00:00:00.000Z"))).toEqual([]);
    expect(h.count("research_run")).toBe(0);
  });
});
