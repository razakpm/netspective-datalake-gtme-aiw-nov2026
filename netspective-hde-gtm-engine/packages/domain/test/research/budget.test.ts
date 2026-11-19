import { describe, expect, it } from "vitest";
import {
  actualCost,
  canAfford,
  estimateInputTokens,
  formatMicros,
  parseMicros,
  remainingAccountAllowance,
  remainingRunBudget,
  validateRunBudget,
  worstCaseCost,
} from "../../src/index.js";

// Task T021: integer micro-unit budget rules (research R-03). No floating point anywhere.
const rate = { inMicrosPer1k: 1000, outMicrosPer1k: 5000 };

describe("money", () => {
  it("parses and formats decimal amounts exactly", () => {
    expect(parseMicros("2.00")).toBe(2_000_000);
    expect(parseMicros("0.2")).toBe(200_000);
    expect(parseMicros("12.345678")).toBe(12_345_678);
    expect(parseMicros("7")).toBe(7_000_000);
    for (const bad of ["", "abc", "-1", "1.1234567", "1,5", "1e3"])
      expect(parseMicros(bad)).toBeNull();
    expect(formatMicros(2_000_000)).toBe("2.00");
    expect(formatMicros(200_000)).toBe("0.20");
    expect(formatMicros(12_345_678)).toBe("12.345678");
    expect(formatMicros(1)).toBe("0.000001");
    expect(parseMicros(formatMicros(1_234_500))).toBe(1_234_500);
  });
});

describe("estimates", () => {
  it("rounds input tokens up and prices them with integer arithmetic", () => {
    expect(estimateInputTokens(0)).toBe(0);
    expect(estimateInputTokens(1)).toBe(1);
    expect(estimateInputTokens(4)).toBe(1);
    expect(estimateInputTokens(5)).toBe(2);
    expect(worstCaseCost({ inputTokens: 1000, maxOutputTokens: 1000, rate })).toBe(6000);
    expect(worstCaseCost({ inputTokens: 1, maxOutputTokens: 1, rate })).toBe(1 + 5);
    expect(actualCost({ inputTokens: 500, outputTokens: 100, rate })).toBe(500 + 500);
  });
  it("never lets the actual cost exceed the worst case when output stays within the maximum", () => {
    for (let i = 0; i < 200; i++) {
      const inputTokens = (i * 37) % 5000;
      const maxOutputTokens = 1 + ((i * 53) % 2000);
      const outputTokens = (i * 11) % (maxOutputTokens + 1);
      expect(actualCost({ inputTokens, outputTokens, rate })).toBeLessThanOrEqual(
        worstCaseCost({ inputTokens, maxOutputTokens, rate }),
      );
    }
  });
});

describe("affordability", () => {
  it("allows a call only when the worst case fits the lower of the run and account remainders", () => {
    expect(remainingRunBudget(2_000_000, 1_500_000)).toBe(500_000);
    expect(remainingRunBudget(100, 200)).toBe(0);
    expect(remainingAccountAllowance(20_000_000, 19_000_000, 600_000)).toBe(400_000);
    expect(remainingAccountAllowance(1000, 5000, 0)).toBe(0);
    expect(canAfford({ remainingRun: 500, remainingAccount: 400, worstCase: 400 })).toBe(true);
    expect(canAfford({ remainingRun: 500, remainingAccount: 400, worstCase: 401 })).toBe(false);
    expect(canAfford({ remainingRun: 300, remainingAccount: 900, worstCase: 301 })).toBe(false);
  });
  it("no sequence of affordable calls can exceed the cap", () => {
    for (const cap of [50_000, 2_000_000]) {
      let spent = 0;
      let seed = 7;
      for (let i = 0; i < 500; i++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        const inputTokens = seed % 4000;
        const maxOutputTokens = 1 + (seed % 800);
        const worst = worstCaseCost({ inputTokens, maxOutputTokens, rate });
        if (
          !canAfford({
            remainingRun: remainingRunBudget(cap, spent),
            remainingAccount: Number.MAX_SAFE_INTEGER,
            worstCase: worst,
          })
        )
          continue;
        spent += actualCost({ inputTokens, outputTokens: seed % (maxOutputTokens + 1), rate });
        expect(spent).toBeLessThanOrEqual(cap);
      }
    }
  });
});

describe("run budget validation", () => {
  const limits = { maxSourcesHard: 25, runCapMicros: 2_000_000 };
  it("refuses a budget above the caps or below one", () => {
    expect(validateRunBudget({ maxSources: 10, maxCostMicros: 2_000_000 }, limits)).toEqual([]);
    expect(validateRunBudget({ maxSources: 26, maxCostMicros: 1 }, limits)).toEqual([
      "max_sources_above_limit",
    ]);
    expect(validateRunBudget({ maxSources: 0, maxCostMicros: 1 }, limits)).toEqual([
      "max_sources_invalid",
    ]);
    expect(validateRunBudget({ maxSources: 5, maxCostMicros: 2_000_001 }, limits)).toEqual([
      "max_cost_above_run_cap",
    ]);
    expect(validateRunBudget({ maxSources: 5, maxCostMicros: 0 }, limits)).toEqual([
      "max_cost_invalid",
    ]);
  });
});
