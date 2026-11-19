// Public entry point of the hypotheses module. Other modules import only this file or react to its events.
export {
  HypothesisService,
  BAND_DEFINITIONS,
  type HypothesisInput,
  type HypothesisPatch,
  type HypothesisSummary,
  type HypothesisView,
  type Relevance,
} from "./service.js";
export { HypothesisReview } from "./review.js";
export { HypothesisStaleness } from "./staleness.js";
export { HypothesisProposals } from "./proposals.js";
export { type HypothesisActor } from "./refusal.js";
export { registerHypothesisRoutes, type HypothesisRouteDeps } from "./routes.js";
