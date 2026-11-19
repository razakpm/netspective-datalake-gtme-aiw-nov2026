import type { ResearchRunner } from "../modules/research/index.js";
import type { ResearchSchedules } from "../modules/research/schedule.js";
import type { HandlerRegistry } from "./registry.js";

// Worker handlers for feature 004 (tasks T029, T030). Handlers are idempotent by job key: a run that is no
// longer queued is left alone, and the schedule tick advances `next_run_at`.
export function registerResearchHandlers(
  registry: HandlerRegistry,
  deps: { runner: ResearchRunner; schedules: ResearchSchedules; staleness?: () => number },
): void {
  registry.register("research.run", async (job) => {
    const payload = job.payload as { runId?: string; captured?: Record<string, string> } | null;
    if (!payload?.runId) throw new Error("research.run job without a run id");
    await deps.runner.execute(payload.runId, payload.captured ?? {});
  });
  registry.register("research.schedule", async () => {
    deps.schedules.tick();
  });
  if (deps.staleness) {
    const staleness = deps.staleness;
    registry.register("hypotheses.staleness", async () => {
      staleness();
    });
  }
}
