import type { JobHandler } from "../../src/worker/registry.js";

/** Deterministic failing handler for tests and quickstart V8. */
export const ALWAYS_FAIL_QUEUE = "test.always-fail";
export function alwaysFail(message = "synthetic failure"): JobHandler {
  return () => {
    throw new Error(message);
  };
}
