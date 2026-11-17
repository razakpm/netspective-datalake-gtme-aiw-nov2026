// Retry policy for background jobs (spec FR-025, task T076). Pure: no I/O. Defaults are hypotheses that
// the config module can override (JOB_MAX_ATTEMPTS, JOB_BACKOFF_*).

export interface RetryPolicy {
  maxAttempts: number;
  baseSeconds: number;
  factor: number;
  capSeconds: number;
  /** 0 to 1: the delay is reduced by up to this fraction at random, so retries do not synchronise. */
  jitterRatio: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseSeconds: 30,
  factor: 2,
  capSeconds: 3600,
  jitterRatio: 0.2,
};

/** Delay before the retry that follows failed attempt number `attempt` (1-based). */
export function retryDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new Error("attempt must be a positive integer");
  if (policy.factor < 1) throw new Error("backoff factor must be at least 1");
  if (policy.jitterRatio < 0 || policy.jitterRatio > 1)
    throw new Error("jitter ratio must be 0 to 1");
  const capMs = policy.capSeconds * 1000;
  // Avoid Infinity for large attempt numbers: stop multiplying once the cap is reached.
  let delay = policy.baseSeconds * 1000;
  for (let i = 1; i < attempt && delay < capMs; i++) delay *= policy.factor;
  delay = Math.min(delay, capMs);
  return Math.floor(delay * (1 - policy.jitterRatio * random()));
}

/** After a failed attempt, retry while attempts remain, otherwise the job fails (terminal). */
export function nextAfterFailure(attemptsMade: number, policy: RetryPolicy): "retry" | "fail" {
  return attemptsMade < policy.maxAttempts ? "retry" : "fail";
}
