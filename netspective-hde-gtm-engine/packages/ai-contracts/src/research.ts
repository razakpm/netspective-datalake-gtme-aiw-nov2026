import { z } from "zod";

// Structured outputs of the research and problem-interpretation agents (feature 004, constitution X).
// Every schema is strict: no reasoning or chain-of-thought field exists, confidence is a band (never a
// number), and an evidence status the agent may not hold (observed, buyer-confirmed) has no field at all.
// Nothing here is trusted until the gateway has validated it and the deterministic verifier has checked it
// against the fetched sources.

export const PROTECTED_TOPICS = [
  "data_architecture",
  "source_systems",
  "budget",
  "project_status",
  "buying_authority",
] as const;
export type ProtectedTopic = (typeof PROTECTED_TOPICS)[number];

export const FINDING_TOPICS = [...PROTECTED_TOPICS, "other"] as const;
export type FindingTopic = (typeof FINDING_TOPICS)[number];

export const BandSchema = z.enum(["low", "medium", "high"]);
export type Band = z.infer<typeof BandSchema>;

const Key = z.string().min(1).max(40);

/** One extracted finding. `key` is local to the output; sources are referenced by fetch id. */
export const ExtractedFindingSchema = z
  .object({
    key: Key,
    kind: z.enum(["fact", "inference", "unknown", "contradiction"]),
    topic: z.enum(FINDING_TOPICS),
    statement: z.string().min(3).max(500),
    /** A short quote that must occur in the cited source (verified by code, never trusted). */
    supportingText: z.string().min(3).max(240).optional(),
    sourceFetchId: z.string().min(1).max(64).optional(),
    secondSourceFetchId: z.string().min(1).max(64).optional(),
    /** For inferences: the keys of the findings they rest on. */
    basisKeys: z.array(Key).max(10).optional(),
    /** A feature 003 signal type key; findings with another key are dropped. */
    typeKey: z.string().min(1).max(80).optional(),
    extractionConfidence: BandSchema,
  })
  .strict()
  .superRefine((f, ctx) => {
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (f.kind === "fact") {
      need(Boolean(f.sourceFetchId), "sourceFetchId", "a fact must cite a source");
      need(Boolean(f.supportingText), "supportingText", "a fact must carry a supporting quote");
    }
    if (f.kind === "inference") {
      need(
        Boolean(f.sourceFetchId) || (f.basisKeys?.length ?? 0) > 0,
        "basisKeys",
        "an inference needs a basis",
      );
      need(
        (f.basisKeys?.length ?? 0) > 0,
        "basisKeys",
        "an inference needs at least one basis finding",
      );
    }
    if (f.kind === "contradiction") {
      need(Boolean(f.sourceFetchId), "sourceFetchId", "a contradiction cites two sources");
      need(
        Boolean(f.secondSourceFetchId),
        "secondSourceFetchId",
        "a contradiction cites two sources",
      );
      need(
        f.sourceFetchId !== f.secondSourceFetchId,
        "secondSourceFetchId",
        "the two sources must differ",
      );
    }
  });
export type ExtractedFinding = z.infer<typeof ExtractedFindingSchema>;

/** SignalExtraction: the list of findings the extraction step returns for one or more sources. */
export const SignalExtractionSchema = z
  .object({ findings: z.array(ExtractedFindingSchema).max(60) })
  .strict();
export type SignalExtraction = z.infer<typeof SignalExtractionSchema>;

/** AccountResearchSummary: assembled from verified findings; validated before it is stored. */
export const AccountResearchSummarySchema = z
  .object({
    facts: z.array(
      z
        .object({
          key: Key,
          statement: z.string().min(3).max(500),
          sourceFetchId: z.string().min(1).max(64),
          supportingText: z.string().max(240).optional(),
          topic: z.enum(FINDING_TOPICS),
          carriedOver: z.boolean(),
        })
        .strict(),
    ),
    inferences: z.array(
      z
        .object({
          key: Key,
          statement: z.string().min(3).max(500),
          basisKeys: z.array(Key).min(1).max(10),
          extractionConfidence: BandSchema,
        })
        .strict(),
    ),
    unknowns: z.array(
      z.object({ topic: z.enum(FINDING_TOPICS), statement: z.string().min(3).max(300) }).strict(),
    ),
    contradictions: z.array(
      z
        .object({
          key: Key,
          statement: z.string().min(3).max(500),
          sourceFetchIds: z.tuple([z.string().min(1).max(64), z.string().min(1).max(64)]),
        })
        .strict(),
    ),
    sources: z.array(
      z.object({ fetchId: z.string().min(1).max(64), flagged: z.boolean() }).strict(),
    ),
  })
  .strict();
export type AccountResearchSummary = z.infer<typeof AccountResearchSummarySchema>;

const Relevance = z
  .object({
    icp: z
      .array(z.enum(["icp1", "icp2"]))
      .max(2)
      .default([]),
    capability: z.array(z.string().min(1).max(60)).max(20).default([]),
    offer: z.array(z.string().min(1).max(60)).max(20).default([]),
  })
  .strict();

/** One AI-proposed hypothesis. Proposals reference findings by key; the runner maps keys to signal ids. */
export const AccountHypothesisSchema = z
  .object({
    statement: z.string().min(10).max(500),
    category: z.string().min(1).max(60),
    relevance: Relevance,
    supportingFindingKeys: z.array(Key).min(1).max(20),
    contradictoryFindingKeys: z.array(Key).max(20).default([]),
    assumptions: z.array(z.string().min(3).max(300)).max(10).default([]),
    confidence: z.object({ band: BandSchema, explanation: z.string().min(3).max(500) }).strict(),
  })
  .strict();
export type AccountHypothesisProposal = z.infer<typeof AccountHypothesisSchema>;

export const AccountHypothesisProposalsSchema = z
  .object({ proposals: z.array(AccountHypothesisSchema).max(10) })
  .strict();
export type AccountHypothesisProposals = z.infer<typeof AccountHypothesisProposalsSchema>;

/** A match between a buyer's problem statement and a service capability (advisory). */
export const ServiceCapabilityMatchSchema = z
  .object({
    capabilityKey: z.string().min(1).max(60),
    band: BandSchema,
    reason: z.string().min(3).max(300),
  })
  .strict();
export type ServiceCapabilityMatch = z.infer<typeof ServiceCapabilityMatchSchema>;

export const ProblemInterpretationSchema = z
  .object({
    matches: z.array(ServiceCapabilityMatchSchema).max(10),
    discoveryQuestions: z.array(z.string().min(3).max(300)).max(10),
    unknowns: z.array(z.string().min(3).max(300)).max(10),
  })
  .strict();
export type ProblemInterpretation = z.infer<typeof ProblemInterpretationSchema>;
