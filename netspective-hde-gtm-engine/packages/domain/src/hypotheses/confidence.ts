// Banded confidence assessments (feature 004, spec FR-026, research R-13). Bands only, with an explanation:
// no numeric score. Three dimensions are reserved for later features; the hypothesis's own band lives on
// the hypothesis (its column is the source of truth), so no `hypothesis` assessment row is written.

export const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export const WRITABLE_DIMENSIONS = [
  "source_reliability",
  "extraction",
  "entity_match",
  "capability_match",
] as const;
const RESERVED = ["icp_fit", "offer_fit", "qualification_completeness"];

export type AssessmentCheck = { ok: true } | { ok: false; code: string };

export function checkAssessment(input: {
  dimension: string;
  band: string;
  explanation: string;
}): AssessmentCheck {
  if (!(CONFIDENCE_BANDS as readonly string[]).includes(input.band))
    return { ok: false, code: "band_invalid" };
  if (RESERVED.includes(input.dimension)) return { ok: false, code: "dimension_reserved" };
  if (input.dimension === "hypothesis") return { ok: false, code: "dimension_not_written" };
  if (!(WRITABLE_DIMENSIONS as readonly string[]).includes(input.dimension))
    return { ok: false, code: "dimension_unknown" };
  if (input.explanation.trim().length < 3 || input.explanation.length > 500)
    return { ok: false, code: "explanation_required" };
  return { ok: true };
}
