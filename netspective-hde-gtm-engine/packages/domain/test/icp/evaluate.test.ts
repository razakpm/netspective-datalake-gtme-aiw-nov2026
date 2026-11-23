import { describe, expect, it } from "vitest";
import { DEFAULT_ICP_DEFINITIONS } from "../../src/icp/defaults.js";
import { evaluateFit, bestFit, type FitEvidence } from "../../src/icp/evaluate.js";
import { parseIcpDefinition } from "../../src/icp/definition.js";

const icp1 = DEFAULT_ICP_DEFINITIONS.icp1;
const icp2 = DEFAULT_ICP_DEFINITIONS.icp2;
const ev = (topic: string, status: FitEvidence["status"] = "observed"): FitEvidence => ({
  topic,
  status,
});
const input = (
  orgType: string,
  evidence: FitEvidence[] = [],
  staffedBedCount: number | null = null,
) => ({
  orgType,
  staffedBedCount,
  evidence,
});

describe("default ICP definitions", () => {
  it("are valid, labelled hypotheses, with no bed band set", () => {
    for (const d of [icp1, icp2]) {
      expect(parseIcpDefinition(d).ok).toBe(true);
      expect(d.statusLabel).toBe("hypothesis");
    }
    expect(icp2.bedBand).toBeNull();
  });
  it("refuse a malformed definition", () => {
    expect(parseIcpDefinition({ ...icp1, orgTypes: [] }).ok).toBe(false);
    expect(parseIcpDefinition({ ...icp2, bedBand: { min: 500, max: 100 } }).ok).toBe(false);
  });
});

describe("evaluateFit", () => {
  it("excludes an excluded organisation type, for either ICP", () => {
    for (const d of [icp1, icp2])
      expect(evaluateFit(d, input("biotech", [ev("sender_onboarding_friction")])).status).toBe(
        "excluded",
      );
  });
  it("is unknown when the type is unknown", () => {
    expect(evaluateFit(icp1, input("unknown")).status).toBe("unknown");
  });
  it("is weak for a known type the ICP does not target", () => {
    expect(
      evaluateFit(icp1, input("health_system", [ev("sender_onboarding_friction")])).status,
    ).toBe("weak");
  });
  it("is unknown when the type matches but there is no evidence and no size or judgement", () => {
    expect(evaluateFit(icp1, input("health_information_exchange")).status).toBe("unknown");
  });
  it("is strong for ICP 1 with observed onboarding or IG friction", () => {
    for (const topic of ["sender_onboarding_friction", "ig_change_friction"]) {
      const r = evaluateFit(icp1, input("state_medicaid_program_operator", [ev(topic)]));
      expect(r.status).toBe("strong");
      expect(r.met.length).toBeGreaterThan(0);
      expect(r.basis.length).toBeGreaterThan(0);
    }
  });
  it("is possible when the only evidence is inferred", () => {
    expect(
      evaluateFit(
        icp1,
        input("health_information_exchange", [ev("sender_onboarding_friction", "ai_hypothesis")]),
      ).status,
    ).toBe("possible");
  });
  it("is possible for ICP 2 with a judgement but no bed count, and strong only with a count in the band", () => {
    const evidence = [
      ev("mid_size_judgement", "derived_interpretation"),
      ev("stalled_ai_pilot", "buyer_confirmed"),
      ev("demonstrated_data_problem"),
    ];
    expect(evaluateFit(icp2, input("health_system", evidence)).status).toBe("possible");
    const banded = { ...icp2, bedBand: { min: 100, max: 500 } };
    expect(evaluateFit(banded, input("health_system", evidence.slice(1), 250)).status).toBe(
      "strong",
    );
    const outside = evaluateFit(banded, input("health_system", evidence.slice(1), 900));
    expect(outside.status).toBe("possible");
    expect(outside.unmet).toContain("mid_size");
  });
  it("lists no demonstrated data problem as unmet, and stays possible (summitcare)", () => {
    const r = evaluateFit(
      icp2,
      input("health_system", [
        ev("mid_size_judgement", "derived_interpretation"),
        ev("generic_ai_interest"),
      ]),
    );
    expect(r.status).toBe("possible");
    expect(r.unmet).toContain("demonstrated_data_problem");
  });
  it("reports contradictory evidence", () => {
    const r = evaluateFit(
      icp1,
      input("health_information_exchange", [
        ev("sender_onboarding_friction"),
        ev("sender_onboarding_friction", "contradictory"),
      ]),
    );
    expect(r.contradictory).toContain("sender_onboarding_friction");
  });
  it("is deterministic", () => {
    const i = input("health_information_exchange", [ev("ig_change_friction")]);
    expect(evaluateFit(icp1, i)).toEqual(evaluateFit(icp1, structuredClone(i)));
  });
});

describe("bestFit", () => {
  it("picks the ICP with the strongest status and keeps excluded only when both are excluded", () => {
    expect(bestFit({ icp1: "weak", icp2: "possible" })).toEqual({ icp: "icp2", fit: "possible" });
    expect(bestFit({ icp1: "strong", icp2: "weak" })).toEqual({ icp: "icp1", fit: "strong" });
    expect(bestFit({ icp1: "excluded", icp2: "excluded" })).toEqual({
      icp: "icp1",
      fit: "excluded",
    });
    expect(bestFit({ icp1: "excluded", icp2: "unknown" }).fit).toBe("excluded");
    expect(bestFit({ icp1: "unknown", icp2: "weak" })).toEqual({ icp: "icp1", fit: "unknown" });
    expect(bestFit({})).toEqual({ icp: null, fit: "unknown" });
  });
});
