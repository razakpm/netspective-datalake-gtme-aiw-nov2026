import { validateOffer1, validateOffer6 } from "@gtm/domain";
import type { IntakeValidator } from "../engagement/index.js";

// Typed intake for Offers 1 and 6 (feature 006, spec FR-025 to FR-027). The slug decides the schema; the
// schemas are pure and live in the domain package. A submission that passes is stored by `engagement`
// together with its request, labelled non-PHI, and waits for a person to review it.

export const OFFER_1_SLUG = "sender-onboarding-friction-map";
export const OFFER_6_SLUG = "pilot-input-trace-workshop";

export class IntakeRules implements IntakeValidator {
  validate(slug: string, payload: unknown) {
    if (slug === OFFER_1_SLUG) return validateOffer1(payload);
    if (slug === OFFER_6_SLUG) return validateOffer6(payload);
    return { ok: false as const, messages: ["This intake form is not available."] };
  }
}
