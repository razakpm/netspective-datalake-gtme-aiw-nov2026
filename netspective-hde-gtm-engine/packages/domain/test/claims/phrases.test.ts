import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  compilePhraseList,
  CLAIM_CLASSES,
  DEFAULT_PHRASE_RULES,
  RestrictedPhraseListSchema,
} from "../../src/index.js";

// Task T017: the default restricted phrase list is valid data and covers every restricted class.
describe("default phrase list", () => {
  it("validates against its schema", () => {
    expect(RestrictedPhraseListSchema.parse({ rules: DEFAULT_PHRASE_RULES }).rules).toHaveLength(
      DEFAULT_PHRASE_RULES.length,
    );
  });

  it("represents all eight restricted classes", () => {
    const restricted = CLAIM_CLASSES.filter((c) => c !== "general");
    expect(restricted).toHaveLength(8);
    for (const c of restricted) {
      expect(
        DEFAULT_PHRASE_RULES.some((r) => r.class === c),
        c,
      ).toBe(true);
    }
    expect(DEFAULT_PHRASE_RULES.some((r) => (r.class as string) === "general")).toBe(false);
  });

  it("has unique rule ids", () => {
    const ids = DEFAULT_PHRASE_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("has a rule for every id the corpus expects", () => {
    const corpus = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "../../../../tests/fixtures/claims/corpus.json"),
        "utf8",
      ),
    ) as { expected: { rule: string; class: string }[] }[];
    const byId = new Map(DEFAULT_PHRASE_RULES.map((r) => [r.id, r.class]));
    for (const c of corpus) {
      for (const e of c.expected) expect(byId.get(e.rule), e.rule).toBe(e.class);
    }
  });

  it("compiles, and no pattern can match the empty string", () => {
    const compiled = compilePhraseList({ rules: DEFAULT_PHRASE_RULES });
    expect(compiled.length).toBe(DEFAULT_PHRASE_RULES.length);
    for (const r of DEFAULT_PHRASE_RULES) {
      if (r.kind === "pattern") expect(new RegExp(r.pattern, r.flags ?? "u").test("")).toBe(false);
    }
  });
});

describe("list validation", () => {
  it("rejects an unknown kind, an unknown class, an empty phrase list and a bad regex", () => {
    const bad = (rule: unknown) => RestrictedPhraseListSchema.safeParse({ rules: [rule] }).success;
    expect(bad({ id: "a", class: "ai_ready", kind: "fuzzy", phrases: ["x"] })).toBe(false);
    expect(bad({ id: "a", class: "nope", kind: "phrase", phrases: ["x"] })).toBe(false);
    expect(bad({ id: "a", class: "ai_ready", kind: "phrase", phrases: [] })).toBe(false);
    expect(bad({ id: "a", class: "ai_ready", kind: "pattern", pattern: "(" })).toBe(false);
    expect(bad({ id: "a", class: "ai_ready", kind: "pattern", pattern: ".*" })).toBe(false);
    expect(bad({ id: "a", class: "general", kind: "phrase", phrases: ["x"] })).toBe(false);
    expect(bad({ id: "a", class: "ai_ready", kind: "phrase", phrases: ["x"] })).toBe(true);
  });
  it("rejects duplicate ids", () => {
    const r = { id: "a", class: "ai_ready", kind: "phrase", phrases: ["x"] };
    expect(RestrictedPhraseListSchema.safeParse({ rules: [r, r] }).success).toBe(false);
  });
});
