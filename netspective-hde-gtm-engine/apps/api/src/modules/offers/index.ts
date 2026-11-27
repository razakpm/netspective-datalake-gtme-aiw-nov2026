// Public entry point of the offers module (feature 005). Other modules import only this file or react to
// its domain events.
export { OfferService, VersionInputSchema, type OfferDetail } from "./service.js";
export { offerFacts, type OfferFacts } from "./workshop-facts.js";
export { OfferStatusService, MoveInputSchema } from "./status.js";
export { OfferLimitations, LimitationInputSchema } from "./limitations.js";
export {
  type LimitationView,
  type OfferSummary,
  type VersionView,
  wordingHash,
} from "./queries.js";
export {
  CapacityService,
  LimitInputSchema,
  type CapacitySettings,
  type CapacityStatus,
} from "./capacity.js";
export {
  BookingService,
  BookingInputSchema,
  RescheduleInputSchema,
  type BookingView,
} from "./bookings.js";
export {
  PaidTypeService,
  PaidTypeChangeSchema,
  DeliverableInputSchema,
  DeliverableDecisionSchema,
  type DeliverableView,
  type PaidTypeView,
} from "./paid-types.js";
export {
  ScoreService,
  CriterionInputSchema,
  ScoreInputSchema,
  type ScoreSettings,
  type ScoreView,
} from "./scores.js";
export { registerOfferRoutes, type OfferRouteDeps } from "./routes.js";
export {
  RuleSetService,
  DraftInputSchema,
  ActivateInputSchema,
  type RuleSetView,
} from "./rule-sets.js";
export {
  RecommendationService,
  RecommendInputSchema,
  DismissInputSchema,
  type RecommendationSettings,
  type RecommendationView,
} from "./recommendations.js";
export { RoutingContextBuilder, hashContext, type ContextDeps } from "./routing-context.js";
export {
  FakeConsentReader,
  FakePriorInteractions,
  NO_CONSENT_RECORDS,
  NO_PRIOR_INTERACTIONS,
  type ConsentReader,
  type PriorInteractions,
  type Recommender,
} from "./ports.js";
export {
  registerRecommendationRoutes,
  type RecommendationRouteDeps,
} from "./recommendation-routes.js";
export {
  WaitlistService,
  AddInputSchema,
  CloseInputSchema,
  type WaitlistView,
} from "./waitlist.js";
