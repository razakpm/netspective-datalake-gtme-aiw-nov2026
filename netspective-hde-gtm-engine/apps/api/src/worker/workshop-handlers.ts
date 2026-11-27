import type { WorkshopRetention } from "../modules/workshops/index.js";
import type { HandlerRegistry } from "./registry.js";

// Worker handler for feature 007. The tick is enqueued only when WORKSHOP_RETENTION_JOB_ENABLED is true.
// A run is idempotent: a file already deleted is not looked at again.
export function registerWorkshopHandlers(
  registry: HandlerRegistry,
  deps: { retention: WorkshopRetention },
): void {
  registry.register("workshops.retention", async () => {
    await deps.retention.run();
  });
}
