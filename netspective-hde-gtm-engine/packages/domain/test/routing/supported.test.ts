import { describe, expect, it } from "vitest";
import { isSupported } from "../../src/routing/supported.js";
import type { HypothesisFact } from "../../src/routing/types.js";

const h = (patch: Partial<HypothesisFact>): HypothesisFact => ({
  id: "h1",
  category: "onboarding_friction",
  capabilities: [],
  acceptance: "accepted",
  effectiveStatus: "strengthening",
  band: "medium",
  currentSupportingSignals: 1,
  ...patch,
});
const cfg = { supportedMinBand: "medium" as const };

describe("isSupported (spec FR-012)", () => {
  it.each([
    ["strengthening", { effectiveStatus: "strengthening" as const }, true],
    [
      "validated",
      { effectiveStatus: "validated" as const, band: "low" as const, currentSupportingSignals: 0 },
      true,
    ],
    ["untested with a signal at the minimum band", { effectiveStatus: "untested" as const }, true],
    [
      "untested with a signal above the minimum band",
      { effectiveStatus: "untested" as const, band: "high" as const },
      true,
    ],
    [
      "untested with no current signal",
      { effectiveStatus: "untested" as const, currentSupportingSignals: 0 },
      false,
    ],
    [
      "untested one band below the minimum",
      { effectiveStatus: "untested" as const, band: "low" as const },
      false,
    ],
    ["weakening", { effectiveStatus: "weakening" as const }, false],
    ["rejected", { effectiveStatus: "rejected" as const }, false],
    ["stale", { effectiveStatus: "stale" as const }, false],
    ["no effective status", { effectiveStatus: null }, false],
    ["proposed, not accepted", { acceptance: "proposed" as const, effectiveStatus: null }, false],
    ["dismissed", { acceptance: "dismissed" as const, effectiveStatus: null }, false],
  ])("%s", (_name, patch, expected) => {
    expect(isSupported(h(patch), cfg)).toBe(expected);
  });

  it("follows the configured minimum band", () => {
    const untestedMedium = h({ effectiveStatus: "untested", band: "medium" });
    expect(isSupported(untestedMedium, { supportedMinBand: "high" })).toBe(false);
    expect(isSupported(untestedMedium, { supportedMinBand: "low" })).toBe(true);
  });
});
