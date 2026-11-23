import { BANDS, type HypothesisFact, type RoutingConfig } from "./types.js";

// What counts as a supported hypothesis (spec FR-012, research R-05). Pure; reads the effective status
// feature 004 already computes (staleness applied). Every hypothesis that is not supported is weak.

const rank = (band: (typeof BANDS)[number]) => BANDS.indexOf(band);

export function isSupported(
  h: HypothesisFact,
  config: Pick<RoutingConfig, "supportedMinBand">,
): boolean {
  if (h.acceptance !== "accepted") return false;
  const status = h.effectiveStatus;
  if (status === null || status === "rejected" || status === "weakening" || status === "stale") {
    return false;
  }
  if (status === "strengthening" || status === "validated") return true;
  // untested: needs a current approved supporting signal and a confident enough band
  return h.currentSupportingSignals >= 1 && rank(h.band) >= rank(config.supportedMinBand);
}
