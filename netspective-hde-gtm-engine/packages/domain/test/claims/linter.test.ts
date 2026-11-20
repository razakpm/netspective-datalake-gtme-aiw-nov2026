import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PHRASE_RULES,
  LINT_MAX_CHARS,
  lintText,
  type LintMatch,
  type PhraseRule,
} from "../../src/index.js";

// Task T016: the checker over the agreed corpus (spec SC-001), plus its rule kinds, bounds and purity.
interface CorpusCase {
  id: string;
  text: string;
  expected: { class: string; rule: string; text: string; start: number; end: number }[];
}
const corpus = JSON.parse(
  readFileSync(join(import.meta.dirname, "../../../../tests/fixtures/claims/corpus.json"), "utf8"),
) as CorpusCase[];
const list = { rules: DEFAULT_PHRASE_RULES };
const shape = (m: LintMatch) => ({
  class: m.class,
  rule: m.rule,
  text: m.text,
  start: m.start,
  end: m.end,
});

describe("claim checker over the corpus", () => {
  it("has positive and negative cases", () => {
    expect(corpus.filter((c) => c.expected.length > 0).length).toBeGreaterThanOrEqual(20);
    expect(corpus.filter((c) => c.expected.length === 0).length).toBeGreaterThanOrEqual(10);
  });

  it.each(corpus.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    expect(lintText(c.text, list).map(shape)).toEqual(c.expected);
  });

  it("reports positions that point at the matched text in the original", () => {
    for (const c of corpus) {
      for (const m of lintText(c.text, list)) expect(c.text.slice(m.start, m.end)).toBe(m.text);
    }
  });
});

describe("rule kinds", () => {
  it("acronyms are case-sensitive whole tokens", () => {
    for (const text of ["slate", "translate", "Sla", "sla", "BASLA", "SLAB"]) {
      expect(lintText(text, list)).toEqual([]);
    }
    expect(lintText("An SLA, an RTO and an RPO.", list).map((m) => m.rule)).toEqual([
      "sla",
      "rto",
      "rpo",
    ]);
  });

  it("phrases tolerate case, hyphen and space variants but need whole words", () => {
    for (const text of ["AI-READY", "ai ready", "Ai - ready", "AI–ready", "AI‑ready"]) {
      expect(
        lintText(text, list).map((m) => m.rule),
        text,
      ).toEqual(["ai-ready"]);
    }
    for (const text of ["AI-readying", "maintain-ready", "AIready"]) {
      expect(lintText(text, list), text).toEqual([]);
    }
  });

  it("a percentage flags only within five words of an outcome term, in the same sentence", () => {
    expect(lintText("Revenue is up 30% this year.", list)).toEqual([]);
    expect(lintText("We improved throughput by 30% last year.", list).map((m) => m.text)).toEqual([
      "30%",
    ]);
    expect(lintText("Fewer rejections. It is 30% of the plan.", list)).toEqual([]);
    expect(lintText("uptime is 99.95 %", list).map((m) => m.text)).toEqual(["99.95 %"]);
  });

  it("a longer phrase wins over a shorter one inside it", () => {
    const m = lintText("It has multi-tenant isolation.", list);
    expect(m).toHaveLength(1);
    expect(m[0]?.text).toBe("multi-tenant isolation");
  });

  it("is driven entirely by the list passed in", () => {
    const custom: PhraseRule[] = [
      { id: "x", class: "ai_ready", kind: "phrase", phrases: ["blue sky"] },
    ];
    expect(lintText("Blue  Sky thinking", { rules: custom }).map((m) => m.rule)).toEqual(["x"]);
    expect(lintText("Blue sky thinking", { rules: [] })).toEqual([]);
    expect(lintText("AI-ready", { rules: custom })).toEqual([]);
  });
});

describe("bounds and purity", () => {
  it("refuses input over the maximum length instead of silently truncating", () => {
    expect(() => lintText("a".repeat(LINT_MAX_CHARS + 1), list)).toThrow(RangeError);
    expect(() => lintText("a".repeat(LINT_MAX_CHARS), list)).not.toThrow();
  });

  it("runs over 20,000 characters in under 50 ms", () => {
    const sentence = "Netspective reviews sender feeds and reports rejections by sender. ";
    const text = (sentence.repeat(400) + "We are SOC 2 compliant and AI-ready.").slice(
      -LINT_MAX_CHARS,
    );
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      lintText(text, list);
      times.push(performance.now() - t0);
    }
    expect(Math.min(...times)).toBeLessThan(50);
  });

  it("is pure: same input, same output, list and input untouched", () => {
    const before = JSON.stringify(list);
    const a = lintText("We guarantee an SLA.", list);
    const b = lintText("We guarantee an SLA.", list);
    expect(a).toEqual(b);
    expect(JSON.stringify(list)).toBe(before);
  });
});
