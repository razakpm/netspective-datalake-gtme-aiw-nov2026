// Public entry point of the claims module (ADR-019). offers and capabilities import only this file.
export {
  ClaimService,
  ClaimInputSchema,
  EvidenceInputSchema,
  addMonthsUtc,
  type ClaimDetailView,
  type ClaimSettings,
  type EvidenceView,
} from "./service.js";
export {
  checkText,
  effectiveStatus,
  sha256,
  usableClaims,
  type CheckedMatch,
  type CheckResult,
  type ClaimView,
} from "./queries.js";
export { currentPhraseList, getClaim, listEvidence } from "./repository.js";
