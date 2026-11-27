import { z } from "zod";
import { BandSchema } from "./research.js";

// Feature 007 (research R-08, R-09; constitution X, XI): the workshop preparation brief and the notes-assist
// suggestion for findings. Every schema is strict. The model names confirmed facts by evidence identifier
// only (it has no field in which to word one), and the suggestion has no path to a delay confirmation, a
// state, a view, a scope or a finalisation. Nothing here is trusted until the deterministic verifier in
// packages/domain has checked it.

const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const code = z.string().regex(/^[a-z0-9_-]{1,60}$/);
const text = (max: number) => z.string().min(1).max(max);

const EntityIdsSchema = z.object({ workshopId: identifier, accountId: identifier }).strict();

/** What the model is given: identifiers, intake answers and evidence records, all as data. */
export const WorkshopModelInputSchema = z
  .object({
    workshopId: identifier,
    accountId: identifier,
    offerKey: z.string().regex(/^[a-z0-9-]{1,80}$/),
    intake: z.array(z.object({ label: text(80), text: text(4000) }).strict()).max(30),
    evidence: z
      .array(z.object({ id: identifier, topic: code, status: code, text: text(1000) }).strict())
      .max(100),
    /** Offer 6 only: the ten field names of the intake, in order. */
    fieldNames: z.array(text(60)).max(10),
  })
  .strict();

export const WorkshopBriefSchema = z
  .object({
    entityIds: EntityIdsSchema,
    confirmedFactIds: z.array(identifier).max(40),
    inferences: z
      .array(
        z
          .object({
            statement: text(300),
            evidenceIds: z.array(identifier).min(1).max(10),
            contradictingEvidenceIds: z.array(identifier).max(10),
            basis: text(200),
          })
          .strict(),
      )
      .max(12),
    unknowns: z.array(text(300)).max(15),
    suggestedQuestions: z.array(text(200)).max(12),
    artifactChecklist: z.array(z.object({ kind: code, why: text(200) }).strict()).max(12),
    confidence: BandSchema,
    rationale: text(300),
    reviewStatus: z.literal("unreviewed"),
  })
  .strict();

const OWNER_CLASSES = ["operator", "sender", "rule_owner"] as const;
const DELAY_UNITS = ["hours", "days", "weeks"] as const;
const STATUSES = ["known_good", "gap", "unknown"] as const;
const DIMENSIONS = ["quality", "completeness", "freshness", "provenance", "access"] as const;

const upTo = (n: number) => Array.from({ length: n }, (_, i) => i);

/** The complete list of places a suggestion may fill. */
export const FINDINGS_DRAFT_PATHS: readonly string[] = [
  "flowSummary",
  "suggestedNextStep",
  ...upTo(10).map((i) => `unknowns.${i}`),
  ...upTo(3).flatMap((i) =>
    ["description", "ownerClass", "delay.amount", "delay.unit"].map(
      (leaf) => `delaySources.${i}.${leaf}`,
    ),
  ),
  ...upTo(10).flatMap((i) => [
    `fields.${i}.sourceSystem`,
    `fields.${i}.sourceInterface`,
    ...DIMENSIONS.map((d) => `fields.${i}.observations.${d}.status`),
  ]),
];

/** A value a person has to judge: it is applied only when accepted item by item. */
export const isInterpretivePath = (path: string): boolean =>
  path.endsWith(".ownerClass") || path.endsWith(".status");

function valueSchema(path: string): z.ZodType {
  if (path.endsWith(".ownerClass")) return z.enum(OWNER_CLASSES);
  if (path.endsWith(".delay.unit")) return z.enum(DELAY_UNITS);
  if (path.endsWith(".delay.amount")) return z.number().positive().max(1_000_000);
  if (path.endsWith(".status")) return z.enum(STATUSES);
  if (path === "flowSummary") return text(1000);
  if (path === "suggestedNextStep") return text(500);
  if (path.endsWith(".sourceSystem") || path.endsWith(".sourceInterface")) return text(120);
  return text(300);
}

export const WorkshopFindingsDraftSchema = z
  .object({
    entityIds: EntityIdsSchema,
    items: z
      .array(
        z
          .object({
            path: z.enum(FINDINGS_DRAFT_PATHS as [string, ...string[]]),
            value: z.union([z.string().max(1000), z.number()]),
            interpretation: z.boolean(),
            supportingText: z.string().min(3).max(300),
          })
          .strict()
          .superRefine((item, ctx) => {
            if (!valueSchema(item.path).safeParse(item.value).success) {
              ctx.addIssue({
                code: "custom",
                path: ["value"],
                message: "value does not fit the path",
              });
            }
          }),
      )
      .max(80),
    confidence: BandSchema,
    rationale: text(300),
    reviewStatus: z.literal("unreviewed"),
  })
  .strict();

export type WorkshopModelInput = z.infer<typeof WorkshopModelInputSchema>;
export type WorkshopBrief = z.infer<typeof WorkshopBriefSchema>;
export type WorkshopFindingsDraft = z.infer<typeof WorkshopFindingsDraftSchema>;
