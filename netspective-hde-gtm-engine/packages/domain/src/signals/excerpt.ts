// Excerpt limits (spec FR-017, FR-018; research R-05). The global limit is a hard ceiling; a source may
// set a shorter limit or none, never a longer one. Pure.

export const DEFAULT_EXCERPT_MAX_CHARS = 300; // hypothesis, configurable

export type ExcerptWithheldReason = "none" | "too_long" | "source_no_storage";

export interface SourceStorageRule {
  storageRule: "excerpt" | "citation_only";
  excerptMaxChars: number | null;
}

export function effectiveExcerptLimit(globalMax: number, source: SourceStorageRule): number {
  if (source.storageRule === "citation_only") return 0;
  const own = source.excerptMaxChars ?? globalMax;
  return Math.max(0, Math.min(globalMax, own));
}

export interface ExcerptDecision {
  excerpt: string | null;
  withheldReason: ExcerptWithheldReason;
}

export function applyExcerptRule(
  excerpt: string | undefined | null,
  globalMax: number,
  source: SourceStorageRule,
): ExcerptDecision {
  const text = excerpt?.trim() ?? "";
  if (text === "") return { excerpt: null, withheldReason: "none" };
  const limit = effectiveExcerptLimit(globalMax, source);
  if (limit === 0) return { excerpt: null, withheldReason: "source_no_storage" };
  if ([...text].length > limit) return { excerpt: null, withheldReason: "too_long" };
  return { excerpt: text, withheldReason: "none" };
}
