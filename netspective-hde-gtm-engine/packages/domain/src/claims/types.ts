import { z } from "zod";

// Claim rule types (feature 005, ADR-019). Pure data and validation; no I/O and no model call.

export const CLAIM_CLASSES = [
  "general",
  "quantified_outcome",
  "production_status",
  "sla_rto",
  "certification",
  "tenant_isolation",
  "legal_regulatory_compliance",
  "ai_ready",
  "customer_identity",
] as const;
export type ClaimClass = (typeof CLAIM_CLASSES)[number];
export const RESTRICTED_CLAIM_CLASSES = CLAIM_CLASSES.filter((c) => c !== "general");
export type RestrictedClaimClass = Exclude<ClaimClass, "general">;

export const CLAIM_STATUSES = ["draft", "in_review", "approved", "rejected", "withdrawn"] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

const restrictedClass = z.enum(
  RESTRICTED_CLAIM_CLASSES as [RestrictedClaimClass, ...RestrictedClaimClass[]],
);
const ruleId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/, "a lower-case id of letters, digits and hyphens");
const words = z.array(z.string().min(1).max(100)).min(1);

/** A pattern is accepted only if it compiles and cannot match the empty string. */
function patternProblem(source: string, flags: string | undefined): string | null {
  let re: RegExp;
  try {
    re = new RegExp(source, flags ?? "u");
  } catch {
    return "does not compile";
  }
  return re.test("") ? "matches the empty string" : null;
}

export const PhraseRuleSchema = z.discriminatedUnion("kind", [
  /** Whole words, any case; a space or hyphen in the phrase matches either, in any run. */
  z
    .object({ id: ruleId, class: restrictedClass, kind: z.literal("phrase"), phrases: words })
    .strict(),
  /** Whole tokens, case-sensitive (SLA, RTO, SOC 2); a space in the phrase is optional. */
  z
    .object({ id: ruleId, class: restrictedClass, kind: z.literal("acronym"), phrases: words })
    .strict(),
  /** A regular expression applied to the normalised text. */
  z
    .object({
      id: ruleId,
      class: restrictedClass,
      kind: z.literal("pattern"),
      pattern: z.string().min(1).max(300),
      flags: z.string().max(8).optional(),
    })
    .strict()
    .superRefine((rule, ctx) => {
      const problem = patternProblem(rule.pattern, rule.flags);
      if (problem) ctx.addIssue({ code: "custom", path: ["pattern"], message: problem });
    }),
  /** A percentage within `window` words of an outcome term (terms match as word prefixes). */
  z
    .object({
      id: ruleId,
      class: restrictedClass,
      kind: z.literal("outcome_percentage"),
      terms: words,
      window: z.number().int().min(1).max(20),
    })
    .strict(),
]);
export type PhraseRule = z.infer<typeof PhraseRuleSchema>;

export const RestrictedPhraseListSchema = z
  .object({ rules: z.array(PhraseRuleSchema) })
  .strict()
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.rules.forEach((rule, i) => {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: "duplicate rule id" });
      }
      seen.add(rule.id);
    });
  });
/** A phrase list is data; callers may pass frozen lists. */
export interface RestrictedPhraseList {
  readonly rules: readonly PhraseRule[];
}

export interface LintMatch {
  class: RestrictedClaimClass;
  rule: string;
  /** Offsets into the original text (UTF-16 units). */
  start: number;
  end: number;
  /** The matched text as written. */
  text: string;
}
