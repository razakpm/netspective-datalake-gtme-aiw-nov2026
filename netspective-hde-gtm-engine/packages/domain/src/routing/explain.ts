import { isSupported } from "./supported.js";
import {
  DEFAULT_ROUTING_CONFIG,
  type Evaluation,
  type ExclusionCode,
  type RoutingConfig,
  type RoutingContext,
} from "./types.js";

// The deterministic explanation used when the language model is off or its answer is refused
// (research R-06). At most 600 characters; it carries codes and categories, never a name or an email.

export const EXPLANATION_MAX = 600;

const REASON: Record<ExclusionCode, string> = {
  account_excluded: "the account's ICP fit is excluded",
  fit_not_priority: "ICP fit is not a priority fit",
  contact_suppressed: "the contact is suppressed",
  no_communication_permission: "there is no permission to contact",
  offer_unavailable: "is not available",
  capacity_exhausted: "is full for this period",
};

export function explain(
  ctx: RoutingContext,
  ev: Evaluation,
  config: RoutingConfig = DEFAULT_ROUTING_CONFIG,
): string {
  const parts: string[] = [];
  const offer = ev.offerKey ? ctx.offers.find((o) => o.key === ev.offerKey) : undefined;
  if (ev.outcome === "offer" && offer) {
    parts.push(`Recommended: Offer ${offer.number}, by rule ${ev.chosenRuleId}.`);
  } else if (ev.outcome === "research") {
    parts.push("Further research is recommended before any offer.");
  } else {
    parts.push("No action is recommended.");
  }
  const supported = [
    ...new Set(ctx.hypotheses.filter((h) => isSupported(h, config)).map((h) => h.category)),
  ];
  parts.push(
    supported.length > 0
      ? `Supported hypotheses: ${supported.join(", ")}.`
      : "No supported hypothesis.",
  );
  parts.push(`ICP fit: ${ctx.account.fit}.`);
  if (!ev.outreach.allowed) {
    parts.push(`Outreach is blocked: ${ev.outreach.reasons.map((r) => REASON[r]).join("; ")}.`);
  }
  for (const e of ev.excluded) {
    if (e.offerKey === "*") continue;
    const o = ctx.offers.find((x) => x.key === e.offerKey);
    if (o) parts.push(`Offer ${o.number} ${REASON[e.code]}.`);
  }
  const text = parts.join(" ");
  return text.length <= EXPLANATION_MAX ? text : `${text.slice(0, EXPLANATION_MAX - 1)}…`;
}
