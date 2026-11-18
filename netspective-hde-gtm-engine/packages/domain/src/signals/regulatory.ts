import type { SignalKind } from "./taxonomy.js";

// Regulatory and ecosystem signals (spec FR-037 to FR-039; research R-08). Always context-only with a
// re-verify flag; HTI-5 is never final; no statement of compliance anywhere.

export const REGULATORY_STATUSES = ["proposed", "unverified", "reported_final"] as const;
export type RegulatoryStatus = (typeof REGULATORY_STATUSES)[number];

const HTI5 = /\bhti[\s-]?5\b/i;

export function namesHti5(...texts: (string | undefined | null)[]): boolean {
  return texts.some((t) => t !== undefined && t !== null && HTI5.test(t));
}

export interface RegulatoryInput {
  typeKind: SignalKind;
  requestedStatus?: RegulatoryStatus | undefined;
  regulatoryItem?: string | undefined;
  observation: string;
}

export type RegulatoryResult =
  | {
      ok: true;
      regulatoryStatus: RegulatoryStatus | null;
      contextOnly: boolean;
      reverifyRequired: boolean;
    }
  | { ok: false; code: string };

export function applyRegulatoryRules(input: RegulatoryInput): RegulatoryResult {
  if (input.typeKind !== "regulatory") {
    if (input.requestedStatus !== undefined)
      return { ok: false, code: "regulatory_status_not_allowed" };
    return { ok: true, regulatoryStatus: null, contextOnly: false, reverifyRequired: false };
  }
  const status = input.requestedStatus ?? "unverified";
  if (status === "reported_final" && namesHti5(input.regulatoryItem, input.observation)) {
    return { ok: false, code: "hti5_never_final" };
  }
  return { ok: true, regulatoryStatus: status, contextOnly: true, reverifyRequired: true };
}

/** Whether a signal can be used outside the team (FR-039). */
export function externalUseAnswer(s: { contextOnly: boolean; reverifyRequired: boolean }): string {
  if (s.reverifyRequired) return "not_without_reverification";
  return s.contextOnly ? "context_only" : "allowed";
}
