import { guardValue } from "@gtm/domain";
import { fail, type ProviderResult } from "./interfaces/result.js";

// Provider-call wrapper (feature 001 T100 slice; constitution IV): the PHI guard runs on the outbound
// payload, a blocked payload never reaches the provider, provider exceptions become typed errors, and the
// provider-call log line carries the correlation id and outcome but never the payload.

export interface ProviderCallLog {
  provider: string;
  operation: string;
  correlationId: string | null;
  outcome: "ok" | "error" | "phi_blocked";
  errorCode?: string;
  durationMs: number;
}

export async function guardedCall<T>(options: {
  provider: string;
  operation: string;
  correlationId: string | null;
  payload: unknown;
  call: () => Promise<ProviderResult<T>>;
  log?: ((line: ProviderCallLog) => void) | undefined;
  now?: () => number;
}): Promise<ProviderResult<T> & { correlationId: string | null }> {
  const now = options.now ?? (() => Date.now());
  const started = now();
  const done = (result: ProviderResult<T>, outcome: ProviderCallLog["outcome"]) => {
    options.log?.({
      provider: options.provider,
      operation: options.operation,
      correlationId: options.correlationId,
      outcome,
      ...(result.ok ? {} : { errorCode: result.error.code }),
      durationMs: now() - started,
    });
    return { ...result, correlationId: options.correlationId };
  };
  const decision = guardValue(options.payload);
  if (decision.decision !== "allow") {
    return done(fail("phi_blocked", false, decision.rule_ids), "phi_blocked");
  }
  try {
    const result = await options.call();
    return done(result, result.ok ? "ok" : "error");
  } catch {
    return done(fail("provider_exception", true), "error");
  }
}
