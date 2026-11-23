import { isExcludedOrgType, isOrgType } from "../accounts/org-types.js";
import type { IcpDefinition } from "./definition.js";
import type { FitStatus, IcpKey } from "./types.js";

// The pure ICP fit evaluator (feature 002 US3 slice, built in feature 006). Fixed rules, never a model.
// Status meaning (hypothesis, open question #28; the first rule that applies wins): excluded = excluded
// organisation type; unknown = type unknown, or the type matches but there is no evidence and no size;
// weak = known type the ICP does not target; strong = every required criterion met on observed or
// buyer-confirmed evidence; possible = anything else for a matching type.

export interface FitEvidence {
  topic: string;
  status:
    | "observed"
    | "buyer_confirmed"
    | "derived_interpretation"
    | "ai_hypothesis"
    | "unverified_assumption"
    | "contradictory";
}

export interface FitInput {
  orgType: string;
  staffedBedCount: number | null;
  evidence: readonly FitEvidence[];
}

export interface FitResult {
  status: FitStatus;
  confidence: "low" | "medium" | "high";
  met: string[];
  unmet: string[];
  missing: string[];
  contradictory: string[];
  basis: string[];
}

const CONFIRMED = new Set(["observed", "buyer_confirmed"]);
const INFERRED = new Set(["derived_interpretation", "ai_hypothesis", "unverified_assumption"]);

const empty = (
  status: FitStatus,
  confidence: FitResult["confidence"],
  basis: string,
): FitResult => ({
  status,
  confidence,
  met: [],
  unmet: [],
  missing: [],
  contradictory: [],
  basis: [basis],
});

export function evaluateFit(def: IcpDefinition, input: FitInput): FitResult {
  if (isOrgType(input.orgType) && isExcludedOrgType(input.orgType)) {
    return empty("excluded", "high", `Organisation type ${input.orgType} is excluded`);
  }
  if (input.orgType === "unknown" || !isOrgType(input.orgType)) {
    return empty("unknown", "low", "Organisation type is not known");
  }
  if (!def.orgTypes.includes(input.orgType)) {
    return empty(
      "weak",
      "medium",
      `Organisation type ${input.orgType} is not targeted by ${def.icp}`,
    );
  }
  if (input.evidence.length === 0 && input.staffedBedCount === null) {
    return empty("unknown", "low", "The type matches but no evidence or size is recorded");
  }

  const met: string[] = [];
  const unmet: string[] = [];
  const missing: string[] = [];
  const contradictory: string[] = [];
  const basis: string[] = [`Organisation type ${input.orgType} is targeted by ${def.icp}`];
  let allRequiredConfirmed = true;

  for (const c of def.criteria) {
    const own = input.evidence.filter((e) => c.topics.includes(e.topic));
    const confirmed = own.some((e) => CONFIRMED.has(e.status));
    const inferred = own.some((e) => INFERRED.has(e.status));
    if (own.some((e) => e.status === "contradictory")) contradictory.push(c.key);

    let state: "confirmed" | "inferred" | "unmet";
    if (c.kind === "size" && def.bedBand && input.staffedBedCount !== null) {
      state =
        input.staffedBedCount >= def.bedBand.min && input.staffedBedCount <= def.bedBand.max
          ? "confirmed"
          : "unmet";
    } else if (confirmed) state = "confirmed";
    else if (inferred) state = "inferred";
    else state = "unmet";

    if (state === "unmet") {
      unmet.push(c.key);
      if (own.length === 0 && !(c.kind === "size" && input.staffedBedCount !== null)) {
        missing.push(c.key);
      }
      if (c.required) allRequiredConfirmed = false;
    } else {
      met.push(c.key);
      basis.push(`${c.label}: ${state === "confirmed" ? "met" : "met on inferred evidence only"}`);
      if (state === "inferred" && c.required) allRequiredConfirmed = false;
    }
  }

  const strong = allRequiredConfirmed && contradictory.length === 0;
  return {
    status: strong ? "strong" : "possible",
    confidence: strong ? "high" : contradictory.length > 0 ? "low" : "medium",
    met,
    unmet,
    missing,
    contradictory,
    basis,
  };
}

// A matching type with no evidence (unknown) outranks a type the ICP does not target (weak).
const RANK: Record<FitStatus, number> = {
  strong: 4,
  possible: 3,
  unknown: 2,
  weak: 1,
  excluded: 0,
};

/** The account's best fit across the ICPs; excluded wins when either is excluded (exclusion is by type). */
export function bestFit(fits: Partial<Record<IcpKey, FitStatus>>): {
  icp: IcpKey | null;
  fit: FitStatus;
} {
  const entries = (["icp1", "icp2"] as const)
    .filter((k) => fits[k] !== undefined)
    .map((k) => ({ icp: k, fit: fits[k] as FitStatus }));
  if (entries.length === 0) return { icp: null, fit: "unknown" };
  const excluded = entries.find((e) => e.fit === "excluded");
  if (excluded) return excluded;
  return entries.reduce((best, e) => (RANK[e.fit] > RANK[best.fit] ? e : best));
}
