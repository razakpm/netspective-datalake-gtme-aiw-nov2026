// Public entry point of the workshops module (typed intake from feature 006, workshop operations from
// feature 007). Other modules import only this file or react to its domain events.
export { IntakeRules, OFFER_1_SLUG, OFFER_6_SLUG } from "./intake.js";
export type { BookingRoute, HistoryRow, ParticipantRow, WorkshopRow } from "./repository.js";
export {
  WorkshopService,
  ConvertSchema,
  TransitionSchema,
  ListFilterSchema,
  CALENDAR_ATTENTION,
  type LifecycleDeps,
  type LifecycleSettings,
  type WorkshopDetail,
  type WorkshopNotice,
  type WorkshopSummary,
} from "./lifecycle-service.js";
export { ParticipantService, ParticipantSchema } from "./participants.js";
export type { ParticipantView } from "./repository.js";
export { registerWorkshopRoutes, type WorkshopRouteDeps } from "./routes.js";
export {
  ArtifactService,
  ArtifactSchema,
  ArtifactDecisionSchema,
  type ArtifactDeps,
  type ArtifactSettings,
  type ArtifactView,
} from "./artifacts.js";
export {
  FindingsService,
  SaveFindingsSchema,
  FinaliseFindingsSchema,
  FINDINGS_OPEN,
  type FindingView,
  type FindingsView,
} from "./findings.js";
export { SuggestService, SuggestSchema, type Suggestion } from "./suggest.js";
export type { ModelDeps } from "./model.js";
export { BriefService, type BriefDeps, type BriefView } from "./brief.js";
export {
  OutputService,
  EditOutputSchema,
  ShareSchema,
  type OutputDeps,
  type OutputSettings,
  type OutputView,
} from "./output.js";
export { EffortService, type EffortEntry, type OfferEffortSummary } from "./effort.js";
export { WorkshopRetention } from "./retention.js";
