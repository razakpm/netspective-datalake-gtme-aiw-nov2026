// Public entry point of the accounts module. Other modules import only this file or react to its events.
export {
  AccountService,
  type AccountDetail,
  type AccountSummary,
  type AccountViewHooks,
} from "./service.js";
export { registerAccountRoutes, type AccountRouteDeps, type ConflictResolver } from "./routes.js";
export { processAccountRow, ACCOUNT_CSV } from "./import.js";
export { decideMerge, getReviewItem, type Actor } from "./merge.js";
export {
  currentClassification,
  getAccount,
  loadMatchAccounts,
  type AccountRow,
  type Classification,
} from "./repository.js";
export type { ReviewItemRow } from "./review.js";
