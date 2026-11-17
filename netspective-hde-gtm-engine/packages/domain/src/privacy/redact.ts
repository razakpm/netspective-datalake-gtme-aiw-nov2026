import { guardText, guardValue } from "./guard.js";

// Replaces suspected prohibited content with `[REDACTED:<rule_id>]` placeholders (spec FR-014, FR-034).
// Detectors report whether a string matches, not where, so a whole matching string is replaced. The
// result never contains the original text of a replaced value.

export function redactionPlaceholder(ruleIds: readonly string[]): string {
  return `[REDACTED:${[...ruleIds].sort().join(",")}]`;
}

function walk(value: unknown, depth: number): unknown {
  if (depth > 20) return redactionPlaceholder(["GUARD.UNCLASSIFIABLE"]);
  if (typeof value === "string") {
    const decision = guardText(value);
    return decision.decision === "allow" ? value : redactionPlaceholder(decision.rule_ids);
  }
  if (Array.isArray(value)) return value.map((v) => walk(v, depth + 1));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, depth + 1)]),
    );
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    return redactionPlaceholder(["GUARD.UNCLASSIFIABLE"]);
  }
  return value;
}

/** Returns the value unchanged when the guard allows it, else a copy with offending strings replaced. */
export function redactPhi(value: unknown): unknown {
  const whole = guardValue(value);
  if (whole.decision === "allow") return value;
  const walked = walk(value, 0);
  // Matches that only exist across fields (a name in one field, an MRN in another) survive a per-string
  // pass; replace the whole value rather than leak them.
  const again = guardValue(walked);
  return again.decision === "allow" ? walked : redactionPlaceholder(whole.rule_ids);
}
