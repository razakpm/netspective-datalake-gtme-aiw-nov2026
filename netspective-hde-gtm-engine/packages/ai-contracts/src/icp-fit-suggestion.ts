import { z } from "zod";

// Optional AI fit suggestion (feature 002, research R-14). Advisory only: it is stored beside, never
// instead of, the rule result, and no deterministic rule reads it (constitution IX, X).

export const IcpFitSuggestionSchema = z
  .object({
    suggestedStatus: z.enum(["strong", "possible", "weak", "excluded", "unknown"]),
    rationale: z.string().min(1).max(500),
    evidenceIds: z.array(z.string().min(1)).min(1),
    confidenceBand: z.enum(["low", "medium", "high"]),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
    reviewStatus: z.enum(["unreviewed", "accepted", "dismissed"]),
  })
  .strict();

export type IcpFitSuggestion = z.infer<typeof IcpFitSuggestionSchema>;

export const ICP_FIT_SUGGESTION_LABEL = "AI-generated, advisory";

export const ICP_FIT_SUGGESTION_EXAMPLE: IcpFitSuggestion = {
  suggestedStatus: "possible",
  rationale: "Health system type; the stalled pilot is recorded but no data problem is evidenced.",
  evidenceIds: ["evidence-example-1"],
  confidenceBand: "medium",
  model: "fake-model",
  promptVersion: "icp-fit-suggestion-v1",
  reviewStatus: "unreviewed",
};
