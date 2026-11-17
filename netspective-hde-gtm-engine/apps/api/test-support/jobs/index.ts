import type { HandlerRegistry } from "../../src/worker/registry.js";
import { ALWAYS_FAIL_QUEUE, alwaysFail } from "./always-fail.js";
import { ALWAYS_OK_QUEUE, alwaysOk } from "./always-ok.js";

export { ALWAYS_FAIL_QUEUE, ALWAYS_OK_QUEUE, alwaysFail, alwaysOk };

/** Registers the synthetic jobs. Refused in production (task T083). */
export function registerSyntheticJobs(registry: HandlerRegistry): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("synthetic jobs must not be registered in production");
  }
  registry.register(ALWAYS_OK_QUEUE, alwaysOk());
  registry.register(ALWAYS_FAIL_QUEUE, alwaysFail());
}
