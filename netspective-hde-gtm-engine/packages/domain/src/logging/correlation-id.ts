// Correlation IDs tie a request or job to its log lines, audit events and provider calls (spec FR-033).
// Inbound IDs are untrusted: only a conservative alphabet and length are accepted so an ID can never
// be used for log injection. Anything else is replaced.

/** Accepted inbound shape: 8-64 characters from [A-Za-z0-9._-]. */
export const CORRELATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export function isWellFormedCorrelationId(value: unknown): value is string {
  return typeof value === "string" && CORRELATION_ID_PATTERN.test(value);
}

/**
 * Keep a well-formed inbound ID, otherwise return a freshly generated one.
 * A repeated header (string[]) is treated as malformed because its meaning is ambiguous.
 */
export function resolveCorrelationId(inbound: unknown, generate: () => string): string {
  return isWellFormedCorrelationId(inbound) ? inbound : generate();
}
