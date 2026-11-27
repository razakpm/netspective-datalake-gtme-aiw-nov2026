import { CatalogueRefusal, nowOf, type CatalogueActor } from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import type { Tx } from "@gtm/db";
import { getWorkshop, type WorkshopRow } from "./repository.js";

// Shared by the workshops services (feature 007): finding a workshop, refusing a stale copy, and the audit
// record of a change (identifiers, states and codes only: never a name, a note or any other text).

export function workshopOr404(tx: Tx, id: string): WorkshopRow {
  const workshop = getWorkshop(tx, id);
  if (!workshop) {
    throw new CatalogueRefusal(404, "Not found", ["unknown_workshop"], [], "No such workshop.");
  }
  return workshop;
}

export function staleVersion(): CatalogueRefusal {
  return new CatalogueRefusal(
    409,
    "Changed by someone else",
    ["stale_version"],
    [],
    "Someone else changed this. Reload and try again.",
  );
}

export function auditChange(
  tx: Tx,
  actor: CatalogueActor,
  action: string,
  entity: { type: string; id: string },
  after: Record<string, unknown>,
): void {
  recordAudit(
    tx,
    {
      actorId: actor.userId,
      actorType: actor.actorType,
      action,
      entityType: entity.type,
      entityId: entity.id,
      outcome: "success",
      after,
      correlationId: actor.correlationId,
    },
    () => nowOf(actor),
  );
}
