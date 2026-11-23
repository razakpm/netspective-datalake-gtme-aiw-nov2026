import type { FitStatus } from "./types.js";

// Priority eligibility (feature 002 FR-044 slice, built in 006): only a strong or possible fit is eligible
// for outreach prioritisation. Weak, unknown and excluded fits are not. Pure.

export type PriorityEligibility =
  { eligible: true } | { eligible: false; code: "account_excluded" | "fit_not_priority" };

export function priorityEligibility(fit: FitStatus): PriorityEligibility {
  if (fit === "strong" || fit === "possible") return { eligible: true };
  if (fit === "excluded") return { eligible: false, code: "account_excluded" };
  return { eligible: false, code: "fit_not_priority" };
}
