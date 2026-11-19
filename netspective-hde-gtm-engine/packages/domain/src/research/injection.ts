// Deterministic prompt-injection scanner (feature 004, research R-05; constitution XI). It finds embedded
// instructions in fetched content by rule. It never repeats the matched text: a hit is a rule id and an
// offset into the normalised text. Detection never changes what happens next (the content stays data); it
// raises a flag a reviewer can see.

export const INJECTION_RULES_VERSION = "inj-2026.11.1";

interface Rule {
  id: string;
  pattern: RegExp;
}

const RULES: readonly Rule[] = [
  {
    id: "INJ.IGNORE_INSTRUCTIONS",
    pattern:
      /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  },
  {
    id: "INJ.DISREGARD",
    pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:above|previous|prior)\b/i,
  },
  {
    id: "INJ.ROLE_SWITCH",
    pattern: /\byou\s+are\s+now\b|(?:^|[.!?]\s+)(?:system|developer|assistant)\s*:\s*\S/i,
  },
  {
    id: "INJ.REVEAL_PROMPT",
    pattern: /\breveal\s+(?:your|the)\s+(?:system\s+)?(?:prompt|instructions)/i,
  },
  { id: "INJ.MARK_ACCOUNT", pattern: /\bmark\s+(?:this|the)\s+account\s+as\b/i },
  { id: "INJ.TOOL_CALL", pattern: /\b(?:call|invoke|run)\s+the\s+[\w-]+\s+tool\b/i },
  { id: "INJ.FETCH_OTHER", pattern: /\b(?:fetch|visit|download|browse)\s+https?:\/\//i },
  { id: "INJ.DELIMITER_FORGE", pattern: /<<\s*(?:END|DATA)\b/i },
];

export interface InjectionHit {
  ruleId: string;
  index: number;
}

/** Strip zero-width characters and collapse whitespace so obfuscation does not hide a phrase. */
function normalise(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200b-\u200f\u2060\ufeff]/g, "")
    .replace(/\s+/g, " ");
}

export function scanForInjection(text: string): InjectionHit[] {
  const normalised = normalise(text);
  const hits: InjectionHit[] = [];
  for (const rule of RULES) {
    const m = rule.pattern.exec(normalised);
    if (m) hits.push({ ruleId: rule.id, index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index || a.ruleId.localeCompare(b.ruleId));
}
