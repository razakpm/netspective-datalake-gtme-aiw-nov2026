// Synthetic canaries planted by tests to prove nothing leaks into logs, audit rows, errors or
// provider calls (spec FR-034, FR-035, SC-006). They are clearly fake, and gitleaks allow-lists this
// file (.gitleaks.toml). The log-scan harness (tools/log-scan) fails if any of them appears in output.

/** A fake secret. Register it with the logger's secret registry in tests that expect redaction. */
export const CANARY_SECRET = "gtm-canary-secret-7f3a9c1e-not-a-real-secret";

/** A PHI-like string: an MRN and a date of birth next to a fictional person name. */
export const CANARY_PHI = "Patient: Casey Canaryfield MRN: 00987654 DOB: 02/29/1904";

export const CANARIES = [CANARY_SECRET, CANARY_PHI] as const;
