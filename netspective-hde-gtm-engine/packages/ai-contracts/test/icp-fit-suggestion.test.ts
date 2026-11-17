import { describe, expect, it } from "vitest";
import {
  ICP_FIT_SUGGESTION_EXAMPLE,
  ICP_FIT_SUGGESTION_LABEL,
  IcpFitSuggestionSchema,
} from "../src/index.js";

describe("IcpFitSuggestion", () => {
  it("accepts the example", () => {
    expect(IcpFitSuggestionSchema.parse(ICP_FIT_SUGGESTION_EXAMPLE)).toEqual(
      ICP_FIT_SUGGESTION_EXAMPLE,
    );
    expect(ICP_FIT_SUGGESTION_LABEL).toBe("AI-generated, advisory");
  });
  it("rejects missing evidence, long rationale, unknown fields and bad status", () => {
    const bad = (patch: object) =>
      IcpFitSuggestionSchema.safeParse({ ...ICP_FIT_SUGGESTION_EXAMPLE, ...patch }).success;
    expect(bad({ evidenceIds: [] })).toBe(false);
    expect(bad({ rationale: "x".repeat(501) })).toBe(false);
    expect(bad({ suggestedStatus: "great" })).toBe(false);
    expect(bad({ reasoning: "hidden chain of thought" })).toBe(false);
  });
});
