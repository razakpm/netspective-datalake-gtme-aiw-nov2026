import { describe, expect, it } from "vitest";
import { SIGNAL_SUBMISSION_EXAMPLE, SignalSubmissionSchema } from "../src/index.js";

describe("SignalSubmissionSchema", () => {
  it("accepts a provider submission and an AI submission with model and prompt version", () => {
    expect(SignalSubmissionSchema.parse(SIGNAL_SUBMISSION_EXAMPLE).evidenceStatus).toBe("observed");
    expect(
      SignalSubmissionSchema.safeParse({
        ...SIGNAL_SUBMISSION_EXAMPLE,
        extractionMethod: "ai_extracted",
        aiModel: "m",
        aiPromptVersion: "p1",
      }).success,
    ).toBe(true);
  });
  it("requires model and prompt version for AI extraction", () => {
    expect(
      SignalSubmissionSchema.safeParse({
        ...SIGNAL_SUBMISSION_EXAMPLE,
        extractionMethod: "ai_extracted",
      }).success,
    ).toBe(false);
  });
  it("cannot carry buyer-confirmed status, a reliability override, a manual method or a reasoning trace", () => {
    for (const extra of [
      { evidenceStatus: "buyer_confirmed" },
      { reliability: "high" },
      { extractionMethod: "manual" },
      { reasoning: "chain of thought" },
    ]) {
      expect(
        SignalSubmissionSchema.safeParse({ ...SIGNAL_SUBMISSION_EXAMPLE, ...extra }).success,
      ).toBe(false);
    }
  });
});
