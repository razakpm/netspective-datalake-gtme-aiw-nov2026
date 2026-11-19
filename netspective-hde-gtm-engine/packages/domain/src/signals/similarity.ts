import { normaliseObservation } from "./normalise.js";

// Text similarity for near-duplicate detection (research R-03): trigram Sørensen–Dice over normalised
// observations. Pure and symmetric.

export const DEFAULT_SIGNAL_SIMILARITY_THRESHOLD = 0.85; // hypothesis, configurable

function trigrams(key: string): Set<string> {
  const padded = `  ${key} `;
  const set = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  return set;
}

export function textSimilarity(a: string, b: string): number {
  const ka = normaliseObservation(a);
  const kb = normaliseObservation(b);
  if (ka === "" || kb === "") return 0;
  if (ka === kb) return 1;
  const ta = trigrams(ka);
  const tb = trigrams(kb);
  let shared = 0;
  for (const g of ta) if (tb.has(g)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}
