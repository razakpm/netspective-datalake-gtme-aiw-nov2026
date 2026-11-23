import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { OfferRecommendationExplainSchema } from "./offer-recommendation.js";
import {
  AccountHypothesisProposalsSchema,
  AccountResearchSummarySchema,
  ProblemInterpretationSchema,
  SignalExtractionSchema,
} from "./research.js";

// Schema registry (feature 004, research R-04): schemas by id and version, JSON Schema export, and the
// versioned prompt files. A prompt change is a new version; only identity and hash go in the database.

export interface SchemaEntry {
  id: string;
  version: string;
  schema: z.ZodType;
}

export const SCHEMA_REGISTRY: Readonly<Record<string, SchemaEntry>> = {
  "signal-extraction": {
    id: "signal-extraction",
    version: "1.0.0",
    schema: SignalExtractionSchema,
  },
  "account-research-summary": {
    id: "account-research-summary",
    version: "1.0.0",
    schema: AccountResearchSummarySchema,
  },
  "account-hypothesis-proposals": {
    id: "account-hypothesis-proposals",
    version: "1.0.0",
    schema: AccountHypothesisProposalsSchema,
  },
  "problem-interpretation": {
    id: "problem-interpretation",
    version: "1.0.0",
    schema: ProblemInterpretationSchema,
  },
  "offer-recommendation-explain": {
    id: "offer-recommendation-explain",
    version: "1.0.0",
    schema: OfferRecommendationExplainSchema,
  },
};

export function exportJsonSchemas(): Record<string, unknown> {
  return Object.fromEntries(
    Object.values(SCHEMA_REGISTRY).map((e) => [
      e.id,
      { ...(z.toJSONSchema(e.schema) as object), $id: `${e.id}@${e.version}` },
    ]),
  );
}

export interface PromptDefinition {
  name: "research-extract" | "hypothesis-propose" | "problem-interpret" | "offer-explain";
  version: string;
  task: "extraction" | "synthesis" | "interpretation";
  outputSchemaId: string;
}

export const PROMPTS: readonly PromptDefinition[] = [
  {
    name: "research-extract",
    version: "1.0.0",
    task: "extraction",
    outputSchemaId: "signal-extraction",
  },
  {
    name: "hypothesis-propose",
    version: "1.0.0",
    task: "synthesis",
    outputSchemaId: "account-hypothesis-proposals",
  },
  {
    name: "problem-interpret",
    version: "1.0.0",
    task: "interpretation",
    outputSchemaId: "problem-interpretation",
  },
  {
    name: "offer-explain",
    version: "1.0.0",
    task: "synthesis",
    outputSchemaId: "offer-recommendation-explain",
  },
];

export function promptText(name: PromptDefinition["name"]): string {
  return readFileSync(join(import.meta.dirname, "prompts", `${name}.md`), "utf8");
}

export function promptHash(name: PromptDefinition["name"]): string {
  return createHash("sha256").update(promptText(name)).digest("hex");
}
