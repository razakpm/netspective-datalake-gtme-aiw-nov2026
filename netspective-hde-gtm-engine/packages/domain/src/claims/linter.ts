import { normalise, toOriginalRange, type Normalised } from "./normalise.js";
import {
  RestrictedPhraseListSchema,
  type LintMatch,
  type PhraseRule,
  type RestrictedPhraseList,
} from "./types.js";

// The claim checker (feature 005, research R-06). Deterministic and pure: it reads only its two
// arguments, performs no I/O and never calls a model. The phrase list is data.

export const LINT_MAX_CHARS = 20_000;

const WORD = "[\\p{L}\\p{N}]";
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const bounded = (body: string) => `(?<!${WORD})(?:${body})(?!${WORD})`;

export type CompiledRule =
  | { rule: PhraseRule; kind: "regex"; regexes: RegExp[] }
  | { rule: PhraseRule; kind: "percentage"; terms: string[]; window: number };

function compileRule(rule: PhraseRule): CompiledRule {
  switch (rule.kind) {
    case "phrase":
      return {
        rule,
        kind: "regex",
        regexes: rule.phrases.map(
          (p) =>
            new RegExp(
              bounded(
                p
                  .split(/[\s-]+/u)
                  .filter(Boolean)
                  .map(escape)
                  .join("[\\s-]+"),
              ),
              "giu",
            ),
        ),
      };
    case "acronym":
      return {
        rule,
        kind: "regex",
        regexes: rule.phrases.map(
          (p) =>
            new RegExp(bounded(p.split(/\s+/u).filter(Boolean).map(escape).join("\\s?")), "gu"),
        ),
      };
    case "pattern": {
      const flags = rule.flags ?? "u";
      return {
        rule,
        kind: "regex",
        regexes: [new RegExp(rule.pattern, flags.includes("g") ? flags : `${flags}g`)],
      };
    }
    case "outcome_percentage":
      return {
        rule,
        kind: "percentage",
        terms: rule.terms.map((t) => t.toLowerCase()),
        window: rule.window,
      };
  }
}

const cache = new WeakMap<object, CompiledRule[]>();
/** Validate and compile a list; compiled lists are cached per list object. */
export function compilePhraseList(list: RestrictedPhraseList): CompiledRule[] {
  const cached = cache.get(list);
  if (cached) return cached;
  const parsed = RestrictedPhraseListSchema.parse(list);
  const compiled = parsed.rules.map(compileRule);
  cache.set(list, compiled);
  return compiled;
}

const PERCENT = /\d+(?:\.\d+)?\s?%/gu;
const SENTENCE_END = /[.!?;]$/u;
const stem = (token: string) => token.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function nearOutcomeTerm(
  text: string,
  from: number,
  to: number,
  terms: string[],
  window: number,
): boolean {
  const hit = (token: string) => {
    const s = stem(token);
    return s.length > 0 && terms.some((t) => s.startsWith(t));
  };
  const before = text.slice(0, from).split(/\s+/u).filter(Boolean);
  for (let i = before.length - 1, seen = 0; i >= 0 && seen < window; i--, seen++) {
    const token = before[i] as string;
    if (SENTENCE_END.test(token)) break;
    if (hit(token)) return true;
  }
  const after = text.slice(to).split(/\s+/u).filter(Boolean);
  for (let i = 0; i < after.length && i < window; i++) {
    const token = after[i] as string;
    if (hit(token)) return true;
    if (SENTENCE_END.test(token)) break;
  }
  return false;
}

function findAll(n: Normalised, compiled: CompiledRule): { from: number; to: number }[] {
  const found: { from: number; to: number }[] = [];
  if (compiled.kind === "regex") {
    for (const re of compiled.regexes) {
      re.lastIndex = 0;
      for (let m = re.exec(n.text); m !== null; m = re.exec(n.text)) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        found.push({ from: m.index, to: m.index + m[0].length });
      }
    }
  } else {
    PERCENT.lastIndex = 0;
    for (let m = PERCENT.exec(n.text); m !== null; m = PERCENT.exec(n.text)) {
      const from = m.index;
      const to = from + m[0].length;
      if (nearOutcomeTerm(n.text, from, to, compiled.terms, compiled.window))
        found.push({ from, to });
    }
  }
  return found;
}

/** Flag restricted phrases in `text`: class, rule id, matched text and its position in the original. */
export function lintText(text: string, list: RestrictedPhraseList): LintMatch[] {
  if (text.length > LINT_MAX_CHARS) {
    throw new RangeError(`text is longer than ${LINT_MAX_CHARS} characters`);
  }
  if (text.length === 0) return [];
  const n = normalise(text);
  const raw: (LintMatch & { from: number; to: number; order: number })[] = [];
  compilePhraseList(list).forEach((compiled, order) => {
    for (const { from, to } of findAll(n, compiled)) {
      const range = toOriginalRange(n, from, to);
      raw.push({
        class: compiled.rule.class,
        rule: compiled.rule.id,
        start: range.start,
        end: range.end,
        text: text.slice(range.start, range.end),
        from,
        to,
        order,
      });
    }
  });
  // A longer match hides any match inside it; equal spans keep the first rule in the list.
  raw.sort((a, b) => a.from - b.from || b.to - a.to || a.order - b.order);
  const kept: typeof raw = [];
  for (const m of raw) {
    if (!kept.some((k) => m.from >= k.from && m.to <= k.to)) kept.push(m);
  }
  return kept.map(({ class: cls, rule, start, end, text: t }) => ({
    class: cls,
    rule,
    start,
    end,
    text: t,
  }));
}
