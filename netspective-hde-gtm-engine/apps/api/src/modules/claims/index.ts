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
  coverReport,
  effectiveStatus,
  sha256,
  usableClaims,
  type CheckedMatch,
  type CheckResult,
  type CoverReport,
  type ClaimView,
} from "./queries.js";
export { currentPhraseList, getClaim, listEvidence } from "./repository.js";
export {
  ClaimReviewService,
  ReviewInputSchema,
  WithdrawInputSchema,
  DispositionInputSchema,
  PublishListSchema,
  sqlPermissionsOf,
  type PermissionsOf,
} from "./review.js";
export { ClaimStaleness, type StalenessActor } from "./staleness.js";
export { registerClaimRoutes, lintOut, type ClaimRouteDeps } from "./routes.js";
