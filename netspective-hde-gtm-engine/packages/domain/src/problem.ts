import { z } from "zod";

// RFC 9457-style problem body used by every API error response (see contracts/*.openapi.yaml).
// `detail` must never contain secrets, tokens or blocked content.
export const ProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  correlationId: z.string(),
  ruleIds: z.array(z.string()).optional(),
  /** Stable refusal codes (for example stale_version) a screen can turn into a plain message. */
  codes: z.array(z.string()).optional(),
});

export type Problem = z.infer<typeof ProblemSchema>;
