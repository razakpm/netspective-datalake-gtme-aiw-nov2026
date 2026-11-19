import { describe, expect, it } from "vitest";
import {
  CATEGORY_FRESHNESS_DAYS,
  SEED_SIGNAL_TYPES,
  SIGNAL_CATEGORIES,
  SOURCE_KINDS,
  SOURCE_KIND_RELIABILITY,
} from "../../src/index.js";

describe("signal taxonomy seed", () => {
  it("has every category A-I with at least one type", () => {
    for (const c of SIGNAL_CATEGORIES) {
      expect(SEED_SIGNAL_TYPES.some((t) => t.category === c)).toBe(true);
    }
  });
  it("keeps kind and category aligned", () => {
    for (const t of SEED_SIGNAL_TYPES) {
      expect(t.kind === "regulatory").toBe(t.category === "H");
      expect(t.kind === "first_party").toBe(t.category === "I");
      expect(t.contextOnly).toBe(t.kind === "regulatory");
      if (t.kind === "funding") expect(t.category).toBe("E");
    }
  });
  it("uses the hypothesis windows and unique keys", () => {
    expect(CATEGORY_FRESHNESS_DAYS).toEqual({
      A: 365,
      B: 180,
      C: 180,
      D: 365,
      E: 120,
      F: 90,
      G: 180,
      H: 365,
      I: 90,
    });
    for (const t of SEED_SIGNAL_TYPES) {
      expect(t.defaultFreshnessDays).toBe(CATEGORY_FRESHNESS_DAYS[t.category]);
    }
    expect(new Set(SEED_SIGNAL_TYPES.map((t) => t.key)).size).toBe(SEED_SIGNAL_TYPES.length);
  });
  it("gives every source kind a default reliability", () => {
    for (const k of SOURCE_KINDS) expect(SOURCE_KIND_RELIABILITY[k]).toBeDefined();
  });
});
