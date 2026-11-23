import type { HypothesisStatus } from "../hypotheses/status.js";
import type { FitStatus, IcpKey } from "../icp/types.js";

export type { FitStatus, IcpKey };

// Types for the routing engine (feature 006, research R-03 to R-05). Pure data, no I/O.

export const TRIGGERS = ["operator", "offer5_download"] as const;
export type Trigger = (typeof TRIGGERS)[number];

export const BANDS = ["low", "medium", "high"] as const;
export type RoutingBand = (typeof BANDS)[number];

/** Offer keys the first rule set names (feature 005 seeds them: Offers 1, 5 and 6). */
export const OFFER_1 = "sender-onboarding-friction-map";
export const OFFER_5 = "ccda-to-fhir-mapping-decision-register";
export const OFFER_6 = "pilot-input-trace-workshop";

export type ConsentState = "given" | "not_given" | "none";

/** One account hypothesis as feature 004 reports it (effective status already applies staleness). */
export interface HypothesisFact {
  id: string;
  category: string;
  capabilities: string[];
  acceptance: "proposed" | "accepted" | "dismissed";
  effectiveStatus: HypothesisStatus | null;
  band: RoutingBand;
  /** Supporting signals that are approved and current (not stale, purged or rejected). */
  currentSupportingSignals: number;
}

export interface ContactFact {
  id: string;
  /** The contact, its account or its keyed email hash is suppressed (feature 002 single check). */
  suppressed: boolean;
  /** Latest consent record for the contact or the keyed email hash. */
  consent: ConsentState;
  /** The contact carries a permitted-use basis from feature 002. */
  permittedBasis: boolean;
  /** Buyer role as stated or confirmed; null when unknown. */
  buyerRole: string | null;
}

export type CapacityKind = "room" | "exhausted" | "no_limit_set";

export interface OfferFact {
  id: string;
  key: string;
  number: number;
  /** In force (approved or available) and not withdrawn or expired. */
  available: boolean;
  capacity: CapacityKind;
  /** Buyer effort the offer asks for, as the catalogue states it; null when not provided. */
  effort: string | null;
}

export interface PriorInteractionsFact {
  downloads: number;
  sessionRequests: number;
  acceptedOffers: number;
}

export interface RoutingContext {
  trigger: Trigger;
  account: { id: string; icp: IcpKey | null; fit: FitStatus };
  contact: ContactFact | null;
  hypotheses: HypothesisFact[];
  offers: OfferFact[];
  prior: PriorInteractionsFact;
}

export interface RoutingConfig {
  /** Lowest confidence band that makes an untested hypothesis supported (FR-012). */
  supportedMinBand: RoutingBand;
}

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = { supportedMinBand: "medium" };

export type Outcome = "offer" | "research" | "no_action";

export type ExclusionCode =
  | "account_excluded"
  | "fit_not_priority"
  | "contact_suppressed"
  | "no_communication_permission"
  | "offer_unavailable"
  | "capacity_exhausted";

export interface Exclusion {
  /** Offer key, or `*` when the whole account or contact is blocked. */
  offerKey: string;
  code: ExclusionCode;
}

export interface MatchedRule {
  ruleId: string;
  priority: number;
  /** Offer key the rule points at, or the outcome name. */
  result: string;
}

export type AlternativeKind = "wait_list" | "offer" | "research" | "do_nothing";
export interface Alternative {
  kind: AlternativeKind;
  offerKey: string | null;
  reason: string;
}

export interface Evaluation {
  ruleSetVersion: number;
  outcome: Outcome;
  offerKey: string | null;
  chosenRuleId: string | null;
  /** Offers that may be recommended (ordered by rule precedence, then offer number). */
  eligible: { offerKey: string; reason: string }[];
  excluded: Exclusion[];
  matched: MatchedRule[];
  outreach: { allowed: boolean; reasons: ExclusionCode[] };
  alternatives: Alternative[];
  limitations: string[];
}
