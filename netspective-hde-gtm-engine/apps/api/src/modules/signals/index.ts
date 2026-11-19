// Public entry point of the signals module. Other modules import only this file or react to its events.
export {
  SignalService,
  type RecordInput,
  type RecordResult,
  type SignalSettings,
} from "./service.js";
export { ReviewService, type ReviewInput } from "./review.js";
export { SourceService, type SourceInput, type SourceView } from "./sources.js";
export { SignalRefusal, type SignalActor } from "./actor.js";
export {
  currentEvidence,
  getSignalDetail,
  listAccountSignals,
  listSignals,
  type FeedFilters,
  type SignalDetail,
  type SignalSummary,
} from "./queries.js";
export { resolveAccountScope } from "./repository.js";
export { registerSignalRoutes, type SignalRouteDeps } from "./routes.js";
