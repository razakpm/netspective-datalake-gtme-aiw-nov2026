import { describe, expect, it } from "vitest";
import { normalise, normaliseForCompare, toOriginalRange } from "../../src/index.js";

// Task T015: normalisation for the claim checker. Case is kept (acronym rules are case-sensitive);
// hyphen, dash and space variants are unified; offsets map back into the original text.
describe("normalise", () => {
  it("applies NFKC (full-width letters, ligatures, non-breaking hyphen and space)", () => {
    expect(normalise("ＡＩ").text).toBe("AI");
    expect(normalise("ﬁnd").text).toBe("find");
    expect(normalise("AI‑ready").text).toBe("AI-ready");
    expect(normalise("A B").text).toBe("A B");
  });

  it("unifies hyphen and dash variants to a hyphen and every space to one space", () => {
    for (const dash of ["‐", "‑", "‒", "–", "—", "−", "－"]) {
      expect(normalise(`AI${dash}ready`).text).toBe("AI-ready");
    }
    expect(normalise("a \t\n  b").text).toBe("a b");
    expect(normalise("a b").text).toBe("a b");
  });

  it("keeps case", () => {
    expect(normalise("SLA and sla").text).toBe("SLA and sla");
  });

  it("returns empty text for an empty string", () => {
    expect(normalise("")).toEqual({ text: "", start: [], end: [] });
  });

  it("maps normalised ranges back to exact ranges in the original text", () => {
    const original = "x  AI‑ready now";
    const n = normalise(original);
    expect(n.text).toBe("x AI-ready now");
    const from = n.text.indexOf("AI-ready");
    const range = toOriginalRange(n, from, from + "AI-ready".length);
    expect(original.slice(range.start, range.end)).toBe("AI‑ready");
    expect(range).toEqual({ start: 3, end: 11 });
  });

  it("maps every unit produced by one original character to that character", () => {
    const n = normalise("ﬁx");
    expect(n.text).toBe("fix");
    expect(toOriginalRange(n, 0, 2)).toEqual({ start: 0, end: 1 });
  });

  it("extends a range over a collapsed run of spaces", () => {
    const original = "a   b";
    const n = normalise(original);
    expect(toOriginalRange(n, 0, 3)).toEqual({ start: 0, end: 5 });
  });
});

describe("normaliseForCompare", () => {
  it("lower-cases, trims, collapses spaces and drops trailing sentence punctuation", () => {
    expect(normaliseForCompare("  We are SOC 2  compliant. ")).toBe("we are soc 2 compliant");
    expect(normaliseForCompare("Yes!!")).toBe("yes");
  });
  it("treats hyphen variants as equal", () => {
    expect(normaliseForCompare("AI‑ready")).toBe(normaliseForCompare("AI-ready"));
  });
});
