import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { flagIsCovered, sentenceHash, splitSentences, type CoverClaim } from "../../src/index.js";

// Task T019: sentence splitting, hashing and exact-sentence cover of a flag by an approved claim.
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

describe("splitSentences", () => {
  it("splits on sentence ends and reports positions in the original", () => {
    const text = "We review feeds. Is this clear? Yes!  Done";
    const parts = splitSentences(text);
    expect(parts.map((p) => p.text)).toEqual([
      "We review feeds.",
      "Is this clear?",
      "Yes!",
      "Done",
    ]);
    for (const p of parts) expect(text.slice(p.start, p.end)).toBe(p.text);
  });
  it("does not split inside decimals or dotted acronyms followed by lower case", () => {
    expect(splitSentences("We commit to 99.9% uptime.").map((p) => p.text)).toEqual([
      "We commit to 99.9% uptime.",
    ]);
    expect(
      splitSentences("Governed by an S.L.A. with penalties. Next one.").map((p) => p.text),
    ).toEqual(["Governed by an S.L.A. with penalties.", "Next one."]);
  });
  it("splits on line breaks and returns nothing for empty text", () => {
    expect(splitSentences("One\nTwo").map((p) => p.text)).toEqual(["One", "Two"]);
    expect(splitSentences("  ")).toEqual([]);
  });
});

describe("sentenceHash", () => {
  it("hashes the normalised sentence with the injected function", () => {
    expect(sentenceHash("We are SOC 2 compliant.", sha)).toBe(sha("we are soc 2 compliant"));
    expect(sentenceHash("we are  SOC 2 compliant", sha)).toBe(
      sentenceHash("We are SOC 2 compliant.", sha),
    );
    expect(sentenceHash("Something else", sha)).not.toBe(
      sentenceHash("We are SOC 2 compliant.", sha),
    );
  });
});

describe("flagIsCovered", () => {
  const claim = (over: Partial<CoverClaim> = {}): CoverClaim => ({
    text: "We are SOC 2 compliant.",
    effectiveClass: "certification",
    usable: true,
    ...over,
  });
  const flag = (
    claims: CoverClaim[],
    sentence = "We are SOC 2 compliant",
    dispositions: { sentenceHash: string; ruleId: string }[] = [],
  ) => flagIsCovered({ sentence, ruleId: "soc2", claims, dispositions, hash: sha });

  it("is covered by an approved, unexpired claim whose text equals the whole sentence", () => {
    expect(flag([claim()])).toBe(true);
    expect(flag([claim()], "  we are soc 2   compliant! ")).toBe(true);
  });
  it("is not covered by a substring or a longer sentence", () => {
    expect(flag([claim({ text: "SOC 2" })])).toBe(false);
    expect(flag([claim()], "We are SOC 2 compliant and always will be")).toBe(false);
  });
  it("is not covered by a claim that is not usable (not approved, expired or withdrawn)", () => {
    expect(flag([claim({ usable: false })])).toBe(false);
  });
  it("is not covered by a claim recorded as general, since the phrase list found a restricted class", () => {
    expect(flag([claim({ effectiveClass: "general" })])).toBe(false);
  });
  it("is dismissed by a false-positive disposition for that exact sentence and rule only", () => {
    const hash = sentenceHash("Page 50% done", sha);
    expect(flag([], "Page 50% done", [{ sentenceHash: hash, ruleId: "soc2" }])).toBe(true);
    expect(flag([], "Page 50% done", [{ sentenceHash: hash, ruleId: "sla" }])).toBe(false);
    expect(flag([], "Page 51% done", [{ sentenceHash: hash, ruleId: "soc2" }])).toBe(false);
  });
  it("is not covered when there are no claims and no dispositions", () => {
    expect(flag([])).toBe(false);
  });
});
