import { priorityEligibility } from "../icp/eligibility.js";
import type { ContactFact, ExclusionCode, FitStatus, RoutingContext } from "./types.js";

// Deterministic eligibility, decided before any rule is matched and before any language model
// (spec FR-004, research R-04). The order is fixed: fit, suppression, communication permission.

/** Permission to contact: the latest consent record decides; with none, a permitted-use basis does. */
export function hasCommunicationPermission(
  contact: Pick<ContactFact, "consent" | "permittedBasis">,
): boolean {
  if (contact.consent === "given") return true;
  if (contact.consent === "not_given") return false;
  return contact.permittedBasis;
}

export interface Blockers {
  accountLevel: Extract<ExclusionCode, "account_excluded" | "fit_not_priority"> | null;
  /** In the fixed order: contact_suppressed, then no_communication_permission. */
  contactLevel: ExclusionCode[];
}

export function blockersOf(ctx: Pick<RoutingContext, "account" | "contact">): Blockers {
  const fit = priorityEligibility(ctx.account.fit);
  const contactLevel: ExclusionCode[] = [];
  if (ctx.contact?.suppressed || ctx.account.suppressed === true) {
    contactLevel.push("contact_suppressed");
  }
  if (ctx.contact && !hasCommunicationPermission(ctx.contact)) {
    contactLevel.push("no_communication_permission");
  }
  return { accountLevel: fit.eligible ? null : fit.code, contactLevel };
}

/** With no priority fit the outcome is research when fit is unknown and no action otherwise. */
export function blockedOutcome(fit: FitStatus, accountBlocked: boolean): "research" | "no_action" {
  return accountBlocked && fit === "unknown" ? "research" : "no_action";
}
