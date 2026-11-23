import { z } from "zod";
import { ICP_KEYS } from "./types.js";

// An ICP definition (feature 002 slice): the organisation types it targets, its criteria and an optional
// staffed bed band. Versioned configuration stored as rules JSON; an edit makes a new version.

export const CriterionSchema = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,59}$/),
    label: z.string().min(3).max(120),
    required: z.boolean(),
    /** Evidence topics that can satisfy the criterion. */
    topics: z.array(z.string().min(1)).min(1),
    /** `size` criteria use the staffed bed band first, then a recorded judgement. */
    kind: z.enum(["evidence", "size"]),
  })
  .strict();

export const IcpDefinitionSchema = z
  .object({
    icp: z.enum(ICP_KEYS),
    statusLabel: z.literal("hypothesis"),
    orgTypes: z.array(z.string().min(1)).min(1),
    criteria: z.array(CriterionSchema).min(1),
    bedBand: z
      .object({ min: z.number().int().min(0), max: z.number().int().min(0) })
      .strict()
      .refine((b) => b.min <= b.max, "min must not exceed max")
      .nullable(),
  })
  .strict();

export type IcpCriterion = z.infer<typeof CriterionSchema>;
export type IcpDefinition = z.infer<typeof IcpDefinitionSchema>;

export function parseIcpDefinition(
  json: unknown,
): { ok: true; definition: IcpDefinition } | { ok: false; issues: string[] } {
  const parsed = IcpDefinitionSchema.safeParse(json);
  return parsed.success
    ? { ok: true, definition: parsed.data }
    : { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
}
