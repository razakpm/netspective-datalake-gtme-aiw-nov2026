import { z } from "zod";
import { ICP_KEYS } from "../icp/types.js";
import { TRIGGERS } from "./types.js";

// The routing rule set: versioned immutable data validated by this schema (feature 006, research R-03).
// A rule has an id, a priority (the lowest number wins; ties go to the lower rule id), conditions that must
// all hold, and a result. Nothing here calls a model.

const Id = z.string().regex(/^[a-z][a-z0-9-]{1,59}$/);

export const ConditionsSchema = z
  .object({
    trigger: z.enum(TRIGGERS).optional(),
    icp: z.enum(ICP_KEYS).optional(),
    /** A supported hypothesis exists in one of these categories. */
    supportedCategories: z.array(z.string().min(1)).min(1).optional(),
    /** A supported hypothesis exists that carries this capability tag. */
    supportedCapability: z.string().min(1).optional(),
    /** At least `count` distinct categories among supported hypotheses tagged with `capability`. */
    distinctCategories: z
      .object({ capability: z.string().min(1), count: z.number().int().min(2).max(10) })
      .strict()
      .optional(),
    /** Applies when no other rule gave an eligible result. At most one rule uses it. */
    fallback: z.literal(true).optional(),
  })
  .strict();

export const ResultSchema = z.union([
  z.object({ offerKey: z.string().min(1) }).strict(),
  z
    .object({ offerByIcp: z.object({ icp1: z.string().min(1), icp2: z.string().min(1) }).strict() })
    .strict(),
  z.object({ outcome: z.enum(["research", "no_action"]) }).strict(),
  /** Research when fit is possible, strong or unknown; no action when it is weak or excluded. */
  z.object({ byFit: z.literal(true) }).strict(),
]);

export const RuleSchema = z
  .object({
    id: Id,
    priority: z.number().int().min(1).max(1000),
    description: z.string().min(3).max(300),
    when: ConditionsSchema,
    then: ResultSchema,
  })
  .strict();

export const RuleSetSchema = z
  .object({ rules: z.array(RuleSchema).min(1).max(100) })
  .strict()
  .superRefine((set, ctx) => {
    const seen = new Set<string>();
    let fallbacks = 0;
    for (const [i, rule] of set.rules.entries()) {
      if (seen.has(rule.id)) {
        ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: "duplicate rule id" });
      }
      seen.add(rule.id);
      if (rule.when.fallback) fallbacks++;
    }
    if (fallbacks > 1) {
      ctx.addIssue({ code: "custom", path: ["rules"], message: "at most one fallback rule" });
    }
  });

export type Rule = z.infer<typeof RuleSchema>;
export type RuleSet = z.infer<typeof RuleSetSchema>;

export function parseRuleSet(
  json: unknown,
): { ok: true; set: RuleSet } | { ok: false; issues: string[] } {
  const parsed = RuleSetSchema.safeParse(json);
  if (parsed.success) return { ok: true, set: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((i) => `${i.path.join(".") || "(rule set)"}: ${i.message}`),
  };
}

/** Rule set version 1 (a hypothesis, open question #51), in priority order. */
export const RULE_SET_V1: RuleSet = {
  rules: [
    {
      id: "icp1-onboarding-friction",
      priority: 10,
      description:
        "ICP 1 with a supported sender onboarding or IG change hypothesis leads to Offer 1",
      when: { icp: "icp1", supportedCategories: ["onboarding_friction", "ig_change_management"] },
      then: { offerKey: "sender-onboarding-friction-map" },
    },
    {
      id: "icp2-pilot-input",
      priority: 10,
      description:
        "ICP 2 with a supported stalled-pilot or input provenance hypothesis leads to Offer 6",
      when: { icp: "icp2", supportedCategories: ["pilot_input_quality"] },
      then: { offerKey: "pilot-input-trace-workshop" },
    },
    {
      id: "offer5-download-icp1",
      priority: 20,
      description: "A register download by ICP 1 leads to an Offer 1 follow-up",
      when: { trigger: "offer5_download", icp: "icp1" },
      then: { offerKey: "sender-onboarding-friction-map" },
    },
    {
      id: "offer5-download-icp2",
      priority: 20,
      description: "A register download by ICP 2 leads to an Offer 6 follow-up",
      when: { trigger: "offer5_download", icp: "icp2" },
      then: { offerKey: "pilot-input-trace-workshop" },
    },
    {
      id: "multi-format-gap",
      priority: 30,
      description:
        "A multi-format gap in at least two categories leads to Offer 1 or Offer 6 by ICP",
      when: { distinctCategories: { capability: "multi_format_intake", count: 2 } },
      then: {
        offerByIcp: {
          icp1: "sender-onboarding-friction-map",
          icp2: "pilot-input-trace-workshop",
        },
      },
    },
    {
      id: "ccda-fhir-decisions",
      priority: 40,
      description: "Unresolved CCDA-to-FHIR decisions lead to Offer 5",
      when: { supportedCapability: "ccda_to_fhir_mapping" },
      then: { offerKey: "ccda-to-fhir-mapping-decision-register" },
    },
    {
      id: "no-supported-hypothesis",
      priority: 90,
      description: "No supported hypothesis: further research, or no action when fit is weak",
      when: { fallback: true },
      then: { byFit: true },
    },
  ],
};
