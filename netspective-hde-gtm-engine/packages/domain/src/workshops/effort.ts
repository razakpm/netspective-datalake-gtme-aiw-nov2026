import { z } from "zod";
import type { WorkshopState } from "./lifecycle.js";

// Delivery effort (feature 007, spec FR-033, research R-13). Pure. The figures test the offers' effort
// estimates, which stay hypotheses; a workshop with nothing recorded is missing, never zero.

export const EffortSchema = z
  .object({
    prepHours: z.number().min(0).max(80).multipleOf(0.25),
    sessionHours: z.number().min(0).max(24),
    people: z.number().int().min(1).max(20),
  })
  .strict();
export type Effort = z.infer<typeof EffortSchema>;

export interface EffortTotals {
  workshops: number;
  withEffort: number;
  missing: number;
  totalPrepHours: number;
  totalSessionHours: number;
  averagePrepHours: number | null;
  averageSessionHours: number | null;
  averagePeople: number | null;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** `effort` is each workshop's current entry. A cancelled workshop with none is not counted at all. */
export function summariseEffort(
  rows: readonly { state: WorkshopState; effort: Effort | null }[],
): EffortTotals {
  const counted = rows.filter((r) => r.state !== "cancelled" || r.effort !== null);
  const recorded = counted.flatMap((r) => (r.effort ? [r.effort] : []));
  const total = (pick: (e: Effort) => number) => recorded.reduce((sum, e) => sum + pick(e), 0);
  const average = (pick: (e: Effort) => number) =>
    recorded.length > 0 ? round(total(pick) / recorded.length) : null;
  return {
    workshops: counted.length,
    withEffort: recorded.length,
    missing: counted.length - recorded.length,
    totalPrepHours: round(total((e) => e.prepHours)),
    totalSessionHours: round(total((e) => e.sessionHours)),
    averagePrepHours: average((e) => e.prepHours),
    averageSessionHours: average((e) => e.sessionHours),
    averagePeople: average((e) => e.people),
  };
}
