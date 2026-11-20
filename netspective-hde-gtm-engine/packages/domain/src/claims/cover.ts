import { normaliseForCompare } from "./normalise.js";
import type { ClaimClass } from "./types.js";

// Sentence splitting, hashing and cover of a flag by an approved claim (feature 005, research R-04).
// A flag is covered only when the whole sentence equals the text of an approved, unexpired claim.

export interface SentencePart {
  text: string;
  /** Offsets into the text given to `splitSentences`. */
  start: number;
  end: number;
}

const ENDS = /[.!?]/u;

export function splitSentences(text: string): SentencePart[] {
  const parts: SentencePart[] = [];
  const push = (from: number, to: number) => {
    let s = from;
    let e = to;
    while (s < e && /\s/u.test(text[s] as string)) s++;
    while (e > s && /\s/u.test(text[e - 1] as string)) e--;
    if (e > s) parts.push({ text: text.slice(s, e), start: s, end: e });
  };
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === "\n") {
      push(from, i);
      from = i + 1;
      continue;
    }
    if (!ENDS.test(ch)) continue;
    let j = i;
    while (j + 1 < text.length && ENDS.test(text[j + 1] as string)) j++;
    const after = text[j + 1];
    if (after !== undefined && /\s/u.test(after)) {
      let k = j + 1;
      while (k < text.length && /\s/u.test(text[k] as string) && text[k] !== "\n") k++;
      const next = text[k];
      if (next === undefined || next === "\n" || !/\p{Ll}/u.test(next)) {
        push(from, j + 1);
        from = k;
        i = k - 1;
        continue;
      }
    }
    i = j;
  }
  push(from, text.length);
  return parts;
}

/** Hash of the normalised sentence; the hash function is injected so the domain stays free of I/O. */
export const sentenceHash = (sentence: string, hash: (value: string) => string): string =>
  hash(normaliseForCompare(sentence));

export interface CoverClaim {
  text: string;
  effectiveClass: ClaimClass;
  /** Approved and not needs_review (evidence valid), decided by the caller at read time. */
  usable: boolean;
}

export interface Disposition {
  sentenceHash: string;
  ruleId: string;
}

export function flagIsCovered(input: {
  sentence: string;
  ruleId: string;
  claims: readonly CoverClaim[];
  dispositions: readonly Disposition[];
  hash: (value: string) => string;
}): boolean {
  const h = sentenceHash(input.sentence, input.hash);
  if (input.dispositions.some((d) => d.sentenceHash === h && d.ruleId === input.ruleId))
    return true;
  const target = normaliseForCompare(input.sentence);
  return input.claims.some(
    (c) => c.usable && c.effectiveClass !== "general" && normaliseForCompare(c.text) === target,
  );
}
