import { z } from "zod";

// Signal submission from a provider or an AI extractor (feature 003, research R-10, constitution X).
// Every submission is validated here and then by exactly the same rules as a manual entry; it always
// enters as unreviewed and can never carry buyer-confirmed status or a reliability override. No
// reasoning trace field exists: only the observation and a short excerpt.

export const SignalSubmissionSchema = z
  .object({
    accountId: z.string().min(1).max(64),
    contactId: z.string().min(1).max(64).optional(),
    typeKey: z.string().min(1).max(80),
    observation: z.string().min(3).max(1000),
    excerpt: z.string().max(1000).optional(),
    observedAt: z.iso.datetime(),
    publishedAt: z.iso.datetime().optional(),
    source: z
      .object({
        sourceId: z.string().min(1).max(64).optional(),
        name: z.string().min(1).max(200).optional(),
        ref: z.string().min(1).max(1000),
        itemKey: z.string().min(1).max(200).optional(),
      })
      .strict(),
    extractionMethod: z.enum(["provider", "ai_extracted"]),
    extractionConfidence: z.enum(["low", "medium", "high"]),
    evidenceStatus: z
      .enum(["observed", "derived_interpretation", "ai_hypothesis", "unverified_assumption"])
      .default("observed"),
    aiModel: z.string().min(1).max(100).optional(),
    aiPromptVersion: z.string().min(1).max(100).optional(),
  })
  .strict()
  .refine((v) => v.extractionMethod !== "ai_extracted" || (v.aiModel && v.aiPromptVersion), {
    message: "aiModel and aiPromptVersion are required for ai_extracted submissions",
  });

export type SignalSubmission = z.infer<typeof SignalSubmissionSchema>;

export const SIGNAL_SUBMISSION_EXAMPLE: SignalSubmission = {
  accountId: "account-example",
  typeKey: "implementation_guide_change",
  observation: "The exchange published an updated implementation guide.",
  observedAt: "2026-11-10T00:00:00.000Z",
  source: { sourceId: "default-source-provider", ref: "https://example.org/ig" },
  extractionMethod: "provider",
  extractionConfidence: "medium",
  evidenceStatus: "observed",
};
