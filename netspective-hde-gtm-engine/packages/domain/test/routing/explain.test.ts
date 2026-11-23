import { describe, expect, it } from "vitest";
import corpus from "../../src/routing/corpus.json" with { type: "json" };
import { evaluate } from "../../src/routing/evaluate.js";
import { explain } from "../../src/routing/explain.js";
import { RULE_SET_V1 } from "../../src/routing/rules.js";
import { DEFAULT_ROUTING_CONFIG, type RoutingContext } from "../../src/routing/types.js";
import type { Corpus } from "../../src/routing/corpus.js";

const base = (corpus as unknown as Corpus).base as unknown as RoutingContext;
const ctx: RoutingContext = {
  ...base,
  hypotheses: [
    {
      id: "h1",
      category: "onboarding_friction",
      capabilities: [],
      acceptance: "accepted",
      effectiveStatus: "strengthening",
      band: "medium",
      currentSupportingSignals: 1,
    },
  ],
};

describe("template explanation", () => {
  const ev = evaluate(ctx, RULE_SET_V1, 1, DEFAULT_ROUTING_CONFIG);
  const text = explain(ctx, ev);

  it("names the chosen rule and the supported hypothesis category", () => {
    expect(text).toContain("icp1-onboarding-friction");
    expect(text).toContain("onboarding_friction");
  });
  it("stays within 600 characters and never carries a name or an email", () => {
    expect(text.length).toBeLessThanOrEqual(600);
    expect(text).not.toMatch(/@/);
  });
  it("says why outreach is blocked", () => {
    const blocked = evaluate(
      { ...ctx, contact: { ...ctx.contact!, suppressed: true } },
      RULE_SET_V1,
      1,
      DEFAULT_ROUTING_CONFIG,
    );
    expect(text).not.toContain("blocked");
    expect(explain({ ...ctx, contact: { ...ctx.contact!, suppressed: true } }, blocked)).toContain(
      "suppressed",
    );
  });
  it("lists excluded offers with their reason", () => {
    const full = evaluate(
      {
        ...ctx,
        offers: ctx.offers.map((o) =>
          o.number === 1 ? { ...o, capacity: "exhausted" as const } : o,
        ),
      },
      RULE_SET_V1,
      1,
      DEFAULT_ROUTING_CONFIG,
    );
    expect(explain(ctx, full)).toContain("full");
  });
});
