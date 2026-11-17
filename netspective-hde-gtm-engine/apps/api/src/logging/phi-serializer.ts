import { guardText, redactPhi, redactionPlaceholder } from "@gtm/domain";

// Guard-backed log scrubbing (task T070, spec FR-034). Applied to every serialised log line, including
// nested objects and error objects, whatever the log level: debug mode does not bypass it.

export function scrubPhiFromLine(line: string): string {
  const trimmed = line.endsWith("\n") ? line.slice(0, -1) : line;
  const newline = line.endsWith("\n") ? "\n" : "";
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const redacted = redactPhi(parsed);
    return redacted === parsed ? line : JSON.stringify(redacted) + newline;
  } catch {
    // Not JSON (should not happen with pino): fall back to treating the whole line as text.
    const decision = guardText(trimmed);
    return decision.decision === "allow" ? line : redactionPlaceholder(decision.rule_ids) + newline;
  }
}
