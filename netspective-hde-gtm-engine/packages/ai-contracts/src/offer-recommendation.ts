import { z } from "zod";

// offer-recommendation-explain@1.0.0 (feature 006, research R-06). The model may only order and explain the
// offers that deterministic rules already found eligible; it can neither add an offer nor change an
// outreach decision. The input is a typed allow-list of identifiers and codes: it has no field that can
// carry external text (page text, signal observations, a contact name or an email address).

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const key = z.string().regex(/^[a-z0-9-]{1,80}$/);
const code = z.string().regex(/^[a-z0-9_-]{1,60}$/);

export const OfferRecommendationInputSchema = z
  .object({
    eligible: z
      .array(z.object({ id: identifier, key, number: z.number().int().min(1).max(10) }).strict())
      .min(1)
      .max(10),
    matchedRules: z.array(code).max(20),
    fit: z.enum(["strong", "possible", "weak", "excluded", "unknown"]),
    hypotheses: z.array(z.object({ category: code, supported: z.boolean() }).strict()).max(50),
    capacity: z
      .array(
        z.object({ offerKey: key, state: z.enum(["room", "exhausted", "no_limit_set"]) }).strict(),
      )
      .max(10),
    /** Our own template sentences, never buyer text. */
    limitations: z.array(z.string().max(200)).max(10),
  })
  .strict();

export const OfferRecommendationExplainSchema = z
  .object({
    /** A permutation of the eligible offer ids, best first. */
    ranking: z.array(identifier).min(1).max(10),
    explanation: z.string().min(1).max(600),
    limitations: z.array(z.string().min(1).max(200)).max(5),
  })
  .strict();

export type OfferRecommendationInput = z.infer<typeof OfferRecommendationInputSchema>;
export type OfferRecommendationExplain = z.infer<typeof OfferRecommendationExplainSchema>;

export type RankingCheck = { ok: true } | { ok: false; reason: string };

/** The ranking must contain every eligible id exactly once and nothing else. */
export function validateRanking(
  ranking: readonly string[],
  eligibleIds: readonly string[],
): RankingCheck {
  if (ranking.length === 0) return { ok: false, reason: "empty_ranking" };
  const eligible = new Set(eligibleIds);
  const seen = new Set<string>();
  for (const id of ranking) {
    if (!eligible.has(id)) return { ok: false, reason: "id_outside_eligible_set" };
    if (seen.has(id)) return { ok: false, reason: "duplicate_id" };
    seen.add(id);
  }
  if (seen.size !== eligible.size) return { ok: false, reason: "missing_id" };
  return { ok: true };
}
