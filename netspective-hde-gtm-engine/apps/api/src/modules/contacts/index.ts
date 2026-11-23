// Public entry point of the contacts module (feature 002 slice built in feature 006). Other modules import
// only this file or react to its domain events.
export {
  ContactsService,
  type ContactsSettings,
  type FindOrCreate,
  type WriteContext,
} from "./service.js";
export {
  SuppressionService,
  SuppressionInputSchema,
  checkSuppression,
  type SuppressionSubject,
} from "./suppression.js";
export { latestBasis, accountOfContact, buyerRoleOf, contactById } from "./repository.js";
