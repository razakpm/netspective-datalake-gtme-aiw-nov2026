import type { JobHandler } from "../../src/worker/registry.js";

/** Deterministic succeeding handler for tests and quickstart V7. Idempotent by construction. */
export const ALWAYS_OK_QUEUE = "test.always-ok";
export function alwaysOk(onRun?: (key: string) => void): JobHandler {
  return (job) => {
    onRun?.(job.idempotencyKey);
  };
}
