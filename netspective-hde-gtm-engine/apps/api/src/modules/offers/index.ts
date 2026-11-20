// Public entry point of the offers module (feature 005). Other modules import only this file or react to
// its domain events.
export { OfferService, VersionInputSchema, type OfferDetail } from "./service.js";
export { OfferStatusService, MoveInputSchema } from "./status.js";
export { OfferLimitations, LimitationInputSchema } from "./limitations.js";
export {
  type LimitationView,
  type OfferSummary,
  type VersionView,
  wordingHash,
} from "./queries.js";
