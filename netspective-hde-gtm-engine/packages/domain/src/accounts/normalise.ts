// Normalisers used for matching (spec FR-004, FR-007). Pure and deterministic.

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A bare hostname, lower-cased, without scheme, path, port, "www." or trailing dot. Null if invalid. */
export function normaliseDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (value === "" || /[\s/:@?#]/.test(value)) return null;
  if (value.endsWith(".")) value = value.slice(0, -1);
  if (value.startsWith("www.")) value = value.slice(4);
  if (value.length > 253) return null;
  const labels = value.split(".");
  if (labels.length < 2 || !labels.every((label) => LABEL.test(label))) return null;
  return value;
}

const LEGAL_WORDS = new Set([
  "inc",
  "llc",
  "ltd",
  "corp",
  "corporation",
  "co",
  "company",
  "the",
  "of",
  "and",
]);
// Generic organisation words ignored when comparing names, so "Riverbend Health" matches
// "Riverbend Health System" (they say nothing about identity).
const GENERIC_WORDS = new Set([
  "health",
  "healthcare",
  "system",
  "systems",
  "group",
  "hospital",
  "hospitals",
]);

function words(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/** Stored form: lower-case, punctuation and legal words removed, single spaces. */
export function normaliseName(name: string): string {
  return words(name)
    .filter((w) => !LEGAL_WORDS.has(w))
    .join(" ");
}

/** Comparison key for similarity: the stored form without generic organisation words. */
export function similarityKey(name: string): string {
  const stored = normaliseName(name);
  const key = stored
    .split(" ")
    .filter((w) => w !== "" && !GENERIC_WORDS.has(w))
    .join(" ");
  return key === "" ? stored : key;
}

/** Normalised business email, or null when it is not a plausible address. */
export function normaliseEmail(input: string): string | null {
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return null;
  return value;
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1);
}
