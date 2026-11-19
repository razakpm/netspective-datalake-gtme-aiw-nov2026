// The hypothesis statement rule (feature 004, spec FR-025, research R-11). A hypothesis is a testable,
// hedged statement. A statement that asserts qualification, funding path, budget approval, buying authority
// or a buyer's decision as established is refused: those are qualification facts owned by a later feature.
// The result is a code only, never the text. Deterministic.

const HEDGE =
  /\b(may|might|could|appears?|seems?|suggests?|reportedly|reported|possibly|probably|likely|would|unclear|uncertain)\b/i;

const RULES: { code: string; pattern: RegExp }[] = [
  {
    code: "asserts_qualification",
    pattern:
      /\b(?:is|are|was|were|now)\s+(?:a\s+)?(?:sales[- ]?)?qualified\b|\bsales[- ]qualified\b|\bSQL\b/i,
  },
  {
    code: "asserts_funding_path",
    pattern: /\bfunding\s+path\b[^.]*\b(?:confirmed|secured|approved|established)\b/i,
  },
  {
    code: "asserts_budget_approval",
    pattern: /\b(?:budget|funding)\b[^.]*\b(?:approved|secured|allocated|signed off)\b/i,
  },
  {
    code: "asserts_buying_authority",
    pattern:
      /\beconomic\s+buyer\b[^.]*\b(?:confirmed|identified|is)\b|\bholds?\s+(?:the\s+)?buying\s+authority\b|\bbuying\s+authority\b[^.]*\b(?:confirmed|held by|is)\b/i,
  },
  {
    code: "asserts_buyer_decision",
    pattern:
      /\b(?:has|have)\s+decided\s+to\s+(?:buy|purchase|proceed)\b|\bwill\s+(?:buy|purchase|sign)\b|\b(?:has|have)\s+chosen\s+netspective\b/i,
  },
];

export type StatementCheck = { ok: true } | { ok: false; code: string };

export function checkStatement(text: string): StatementCheck {
  const t = text.trim();
  if (t.length < 10 || t.length > 500) return { ok: false, code: "statement_length" };
  if (HEDGE.test(t)) return { ok: true };
  for (const r of RULES) if (r.pattern.test(t)) return { ok: false, code: r.code };
  return { ok: true };
}
