import { similarityKey } from "./normalise.js";

// Trigram similarity (Sørensen–Dice) replacing pg_trgm under ADR-015 / ADR-016. Pure and deterministic:
// the same two names always give the same score.

export const DEFAULT_SIMILARITY_THRESHOLD = 0.8; // hypothesis, configurable

function trigrams(key: string): Set<string> {
  const padded = `  ${key} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

export function nameSimilarity(a: string, b: string): number {
  const ka = similarityKey(a);
  const kb = similarityKey(b);
  if (ka === "" || kb === "") return 0;
  if (ka === kb) return 1;
  const ta = trigrams(ka);
  const tb = trigrams(kb);
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
