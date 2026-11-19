// Typed provider outcomes (feature 001 FR-038, research R-01): a provider error is a value, never a thrown
// exception, so callers handle every failure explicitly.

export interface ProviderError {
  code: string;
  retryable: boolean;
  /** Boundary-guard rule ids when a payload was blocked; never content. */
  ruleIds?: string[];
}

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderError };

export const ok = <T>(value: T): ProviderResult<T> => ({ ok: true, value });
export const fail = (
  code: string,
  retryable = false,
  ruleIds?: string[],
): ProviderResult<never> => ({
  ok: false,
  error: { code, retryable, ...(ruleIds ? { ruleIds } : {}) },
});
