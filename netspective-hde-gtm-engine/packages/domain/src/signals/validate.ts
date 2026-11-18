import type { Reliability, SourceKind } from "./taxonomy.js";

// Validation of a new signal (spec FR-001 to FR-006, FR-008, FR-009, FR-011, FR-014). Pure. Refusal
// reasons carry codes and field names only, never any submitted text.

export const EVIDENCE_STATUSES = [
  "observed",
  "buyer_confirmed",
  "derived_interpretation",
  "ai_hypothesis",
  "unverified_assumption",
  "contradictory",
] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

export const EXTRACTION_METHODS = ["manual", "provider", "ai_extracted"] as const;
export type ExtractionMethod = (typeof EXTRACTION_METHODS)[number];
export const EXTRACTION_CONFIDENCES = ["low", "medium", "high"] as const;
export type ExtractionConfidence = (typeof EXTRACTION_CONFIDENCES)[number];
export type ActorKind = "human" | "ai" | "system";

export const SENSITIVITIES = [
  "public",
  "business_contact",
  "confidential_commercial",
  "internal_case_study_restricted",
  "sensitive_operational_metadata",
] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

export const MAX_OBSERVATION_CHARS = 1000;
const TAG_KEY = /^[a-z0-9_]{1,60}$/;

export interface SignalTags {
  icp?: string[] | undefined;
  capability?: string[] | undefined;
  offer?: string[] | undefined;
}

export interface NewSignalInput {
  hasSource: boolean;
  sourceRef: string;
  observation: string;
  observedAt: string;
  publishedAt?: string | undefined;
  evidenceStatus: EvidenceStatus;
  extractionMethod: ExtractionMethod;
  extractionConfidence: ExtractionConfidence;
  aiModel?: string | undefined;
  aiPromptVersion?: string | undefined;
  reliabilityOverride?: Reliability | undefined;
  tags?: SignalTags | undefined;
  actorKind: ActorKind;
  sourceKind: SourceKind | null;
}

export interface Refusal {
  code: string;
  field: string;
}

const validDate = (v: string) => !Number.isNaN(Date.parse(v));

export function validateNewSignal(input: NewSignalInput): Refusal[] {
  const out: Refusal[] = [];
  if (!input.hasSource) out.push({ code: "source_required", field: "source" });
  if (input.sourceRef.trim() === "")
    out.push({ code: "source_reference_required", field: "sourceRef" });
  const obs = input.observation.trim();
  if (obs === "") out.push({ code: "observation_required", field: "observation" });
  else if ([...obs].length > MAX_OBSERVATION_CHARS) {
    out.push({ code: "observation_too_long", field: "observation" });
  }
  if (!validDate(input.observedAt)) out.push({ code: "invalid_date", field: "observedAt" });
  if (input.publishedAt !== undefined && !validDate(input.publishedAt)) {
    out.push({ code: "invalid_date", field: "publishedAt" });
  }
  if (input.extractionMethod === "ai_extracted") {
    if (!input.aiModel?.trim()) out.push({ code: "ai_model_required", field: "aiModel" });
    if (!input.aiPromptVersion?.trim()) {
      out.push({ code: "ai_prompt_version_required", field: "aiPromptVersion" });
    }
  }
  if (input.actorKind === "human" && input.extractionMethod === "provider") {
    out.push({ code: "provider_method_reserved", field: "extractionMethod" });
  }
  if (input.evidenceStatus === "buyer_confirmed") {
    const allowed =
      input.actorKind === "human" &&
      input.extractionMethod === "manual" &&
      input.sourceKind === "buyer_statement";
    if (!allowed) out.push({ code: "buyer_confirmed_not_allowed", field: "evidenceStatus" });
  }
  if (input.reliabilityOverride !== undefined && input.actorKind !== "human") {
    out.push({ code: "reliability_override_not_allowed", field: "reliability" });
  }
  const tags = input.tags;
  if (tags) {
    for (const v of tags.icp ?? []) {
      if (v !== "icp1" && v !== "icp2") out.push({ code: "invalid_tag", field: "tags.icp" });
    }
    for (const v of tags.capability ?? []) {
      if (!TAG_KEY.test(v)) out.push({ code: "invalid_tag", field: "tags.capability" });
    }
    for (const v of tags.offer ?? []) {
      if (!TAG_KEY.test(v)) out.push({ code: "invalid_tag", field: "tags.offer" });
    }
  }
  return out;
}

/** Hypothesis default sensitivity (never `prohibited`, never the restricted case-study class). */
export function deriveSensitivity(input: {
  sourceKind: SourceKind | null;
  hasContact: boolean;
}): Sensitivity {
  if (input.hasContact) return "confidential_commercial";
  switch (input.sourceKind) {
    case "official_publication":
      return "public";
    case "buyer_statement":
    case "provider":
    case "first_party":
      return "confidential_commercial";
    default:
      return "business_contact";
  }
}
