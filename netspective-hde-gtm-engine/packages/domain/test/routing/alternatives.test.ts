import { describe, expect, it } from "vitest";
import { ROUTING_CORPUS } from "../../src/routing/corpus-data.js";
import { contextOf } from "../../src/routing/corpus.js";
import { evaluate } from "../../src/routing/evaluate.js";
import { RULE_SET_V1 } from "../../src/routing/rules.js";
import { DEFAULT_ROUTING_CONFIG } from "../../src/routing/types.js";

// Task T052 (spec FR-014, Scenario G): a full offer is never recommended, and the alternatives are listed.
const run = (id: string) => {
  const c = ROUTING_CORPUS.cases.find((x) => x.id === id)!;
  return evaluate(contextOf(ROUTING_CORPUS, c), RULE_SET_V1, 1, DEFAULT_ROUTING_CONFIG);
};

describe("alternatives for a full offer", () => {
  it("lists the wait-list, Offer 5, research and doing nothing, each with a reason (Scenario G)", () => {
    const ev = run("offer6-full-scenario-g");
    expect(ev.outcome).toBe("research");
    expect(ev.offerKey).toBeNull();
    expect(ev.alternatives.map((a) => a.kind)).toEqual([
      "wait_list",
      "offer",
      "research",
      "do_nothing",
    ]);
    expect(ev.alternatives.every((a) => a.reason.length > 10)).toBe(true);
    expect(ev.alternatives[0]).toMatchObject({
      kind: "wait_list",
      offerKey: "pilot-input-trace-workshop",
    });
    expect(ev.alternatives[0]?.reason).toContain("Offer 6 is full");
    expect(ev.alternatives[1]?.offerKey).toBe("ccda-to-fhir-mapping-decision-register");
  });
  it("omits Offer 5 when it is itself unavailable", () => {
    const ev = run("offer6-full-offer5-unavailable");
    expect(ev.alternatives.map((a) => a.kind)).toEqual(["wait_list", "research", "do_nothing"]);
  });
  it("names the full offer, whichever it is", () => {
    const ev = run("offer1-full-icp1-alternatives");
    expect(ev.alternatives[0]).toMatchObject({
      kind: "wait_list",
      offerKey: "sender-onboarding-friction-map",
    });
    expect(ev.alternatives[0]?.reason).toContain("Offer 1 is full");
  });
  it("gives no alternatives when nothing is full", () => {
    expect(run("r1-match-onboarding").alternatives).toEqual([]);
    expect(run("offer1-unavailable-falls-to-research").alternatives).toEqual([]);
  });
  it("says an offer with no limit is not treated as unlimited, and still recommends it", () => {
    const ev = run("offer6-no-limit-set");
    expect(ev.offerKey).toBe("pilot-input-trace-workshop");
    expect(ev.limitations.join(" ")).toContain("not treated as unlimited");
    expect(ev.excluded).toEqual([]);
  });
  it("is the same on every run", () => {
    expect(run("offer6-full-scenario-g")).toEqual(run("offer6-full-scenario-g"));
  });
});
