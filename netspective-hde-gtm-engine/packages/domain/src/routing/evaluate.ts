import { blockedOutcome, blockersOf } from "./eligibility.js";
import type { Rule, RuleSet } from "./rules.js";
import { isSupported } from "./supported.js";
import {
  OFFER_5,
  type Alternative,
  type Evaluation,
  type Exclusion,
  type ExclusionCode,
  type HypothesisFact,
  type MatchedRule,
  type OfferFact,
  type Outcome,
  type RoutingConfig,
  type RoutingContext,
} from "./types.js";

// The routing engine (feature 006, research R-03, R-04). A pure function: no I/O, no clock, no model.
// Eligibility is decided first. Then every rule is tested, all matches are listed, the lowest priority
// number wins, ties go to the lower rule id, and a rule whose offer is not eligible is passed over.

const byPrecedence = (a: Rule, b: Rule) =>
  a.priority - b.priority || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function conditionsHold(
  rule: Rule,
  ctx: RoutingContext,
  supported: readonly HypothesisFact[],
): boolean {
  const w = rule.when;
  if (w.fallback) return false;
  if (w.trigger !== undefined && ctx.trigger !== w.trigger) return false;
  if (w.icp !== undefined && ctx.account.icp !== w.icp) return false;
  if (
    w.supportedCategories &&
    !supported.some((h) => w.supportedCategories!.includes(h.category))
  ) {
    return false;
  }
  if (
    w.supportedCapability &&
    !supported.some((h) => h.capabilities.includes(w.supportedCapability!))
  ) {
    return false;
  }
  if (w.distinctCategories) {
    const { capability, count } = w.distinctCategories;
    const categories = new Set(
      supported.filter((h) => h.capabilities.includes(capability)).map((h) => h.category),
    );
    if (categories.size < count) return false;
  }
  return true;
}

type Resolved =
  { kind: "offer"; offerKey: string } | { kind: "outcome"; outcome: Outcome } | { kind: "none" };

function resolve(rule: Rule, ctx: RoutingContext): Resolved {
  const t = rule.then;
  if ("offerKey" in t) return { kind: "offer", offerKey: t.offerKey };
  if ("offerByIcp" in t) {
    return ctx.account.icp
      ? { kind: "offer", offerKey: t.offerByIcp[ctx.account.icp] }
      : { kind: "none" };
  }
  if ("outcome" in t) return { kind: "outcome", outcome: t.outcome };
  const weak = ctx.account.fit === "weak" || ctx.account.fit === "excluded";
  return { kind: "outcome", outcome: weak ? "no_action" : "research" };
}

const label = (n: OfferFact) => `Offer ${n.number}`;

export function evaluate(
  ctx: RoutingContext,
  ruleSet: RuleSet,
  ruleSetVersion: number,
  config: RoutingConfig,
): Evaluation {
  const blockers = blockersOf(ctx);
  const reasons: ExclusionCode[] = [
    ...(blockers.accountLevel ? [blockers.accountLevel] : []),
    ...blockers.contactLevel,
  ];

  if (reasons.length > 0) {
    return {
      ruleSetVersion,
      outcome: blockedOutcome(ctx.account.fit, blockers.accountLevel !== null),
      offerKey: null,
      chosenRuleId: null,
      eligible: [],
      excluded: reasons.map((code) => ({ offerKey: "*", code })),
      matched: [],
      outreach: { allowed: false, reasons },
      alternatives: [],
      limitations: [],
    };
  }

  const excluded: Exclusion[] = [];
  const eligibleOffers: OfferFact[] = [];
  for (const o of [...ctx.offers].sort((a, b) => a.number - b.number)) {
    if (!o.available) excluded.push({ offerKey: o.key, code: "offer_unavailable" });
    else if (o.capacity === "exhausted")
      excluded.push({ offerKey: o.key, code: "capacity_exhausted" });
    else eligibleOffers.push(o);
  }
  const eligibleKeys = new Set(eligibleOffers.map((o) => o.key));

  const supported = ctx.hypotheses.filter((h) => isSupported(h, config));
  const rules = [...ruleSet.rules].sort(byPrecedence);

  const matched: MatchedRule[] = [];
  let chosen: { rule: Rule; resolved: Resolved } | null = null;
  const matchedOfferKeys: string[] = [];
  for (const rule of rules) {
    if (!conditionsHold(rule, ctx, supported)) continue;
    const resolved = resolve(rule, ctx);
    if (resolved.kind === "none") continue;
    matched.push({
      ruleId: rule.id,
      priority: rule.priority,
      result: resolved.kind === "offer" ? resolved.offerKey : resolved.outcome,
    });
    if (resolved.kind === "offer") matchedOfferKeys.push(resolved.offerKey);
    if (chosen === null) {
      if (resolved.kind === "outcome" || eligibleKeys.has(resolved.offerKey)) {
        chosen = { rule, resolved };
      }
    }
  }
  if (chosen === null) {
    const fallback = rules.find((r) => r.when.fallback);
    if (fallback) {
      const resolved = resolve(fallback, ctx);
      if (resolved.kind !== "none") {
        matched.push({
          ruleId: fallback.id,
          priority: fallback.priority,
          result: resolved.kind === "offer" ? resolved.offerKey : resolved.outcome,
        });
        chosen = { rule: fallback, resolved };
      }
    }
  }

  let outcome: Outcome = "research";
  let offerKey: string | null = null;
  if (chosen?.resolved.kind === "offer") {
    outcome = "offer";
    offerKey = chosen.resolved.offerKey;
  } else if (chosen?.resolved.kind === "outcome") {
    outcome = chosen.resolved.outcome;
  }

  const rank = (key: string) => {
    const i = matchedOfferKeys.indexOf(key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  const eligible = [...eligibleOffers]
    .sort((a, b) => rank(a.key) - rank(b.key) || a.number - b.number)
    .map((o) => ({
      offerKey: o.key,
      reason: matchedOfferKeys.includes(o.key)
        ? "A routing rule points at this offer."
        : "In force and has room, but no rule points at it.",
    }));

  const limitations: string[] = [];
  if (ctx.contact === null) {
    limitations.push("No contact was given, so communication permission was not checked.");
  } else if (ctx.contact.buyerRole === null) {
    limitations.push("The contact's buyer role is not known.");
  }
  if (supported.length === 0)
    limitations.push("No supported hypothesis was found for this account.");
  const chosenOffer = offerKey ? ctx.offers.find((o) => o.key === offerKey) : undefined;
  if (chosenOffer) {
    if (chosenOffer.capacity === "no_limit_set") {
      limitations.push(
        `${label(chosenOffer)} has no capacity limit set; it is not treated as unlimited.`,
      );
    }
    if (chosenOffer.effort === null) {
      limitations.push(`The buyer effort for ${label(chosenOffer)} has not been provided.`);
    }
  }

  const alternatives: Alternative[] = [];
  const fullKey = matchedOfferKeys.find((k) =>
    excluded.some((e) => e.offerKey === k && e.code === "capacity_exhausted"),
  );
  if (fullKey) {
    const full = ctx.offers.find((o) => o.key === fullKey)!;
    alternatives.push({
      kind: "wait_list",
      offerKey: fullKey,
      reason: `${label(full)} is full for this period; add the account to its wait-list to review when a place opens.`,
    });
    if (fullKey !== OFFER_5 && eligibleKeys.has(OFFER_5)) {
      alternatives.push({
        kind: "offer",
        offerKey: OFFER_5,
        reason: "The CCDA-to-FHIR Mapping Decision Register is open and needs no session.",
      });
    }
    alternatives.push({
      kind: "research",
      offerKey: null,
      reason: "Gather more evidence about the account before offering anything.",
    });
    alternatives.push({
      kind: "do_nothing",
      offerKey: null,
      reason: "Take no action for now; nothing is lost by waiting.",
    });
  }

  return {
    ruleSetVersion,
    outcome,
    offerKey,
    chosenRuleId: chosen?.rule.id ?? null,
    eligible,
    excluded,
    matched,
    outreach: { allowed: true, reasons: [] },
    alternatives,
    limitations,
  };
}
