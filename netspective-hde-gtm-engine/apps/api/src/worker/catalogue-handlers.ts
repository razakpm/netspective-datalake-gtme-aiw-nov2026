import type { ClaimStaleness } from "../modules/claims/index.js";
import type { HandlerRegistry } from "./registry.js";

// Worker handler for feature 005 (task T065). `claims.staleness` is optional: reads compute needs_review
// live, so this only announces each lapse once (events keyed by claim and lapse instant).
export function registerCatalogueHandlers(
  registry: HandlerRegistry,
  deps: { staleness: ClaimStaleness },
): void {
  registry.register("claims.staleness", async () => {
    deps.staleness.apply({ userId: null, actorType: "system", correlationId: null });
  });
}
