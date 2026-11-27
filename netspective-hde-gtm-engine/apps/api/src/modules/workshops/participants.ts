import type { SqliteDatabase } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  requirePermission,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { accountOfContact } from "../contacts/index.js";
import { auditChange, workshopOr404 } from "./actor.js";
import {
  getParticipant,
  insertParticipant,
  markParticipantRemoved,
  participantView,
  type ParticipantRow,
  type ParticipantView,
} from "./repository.js";

// Participants by name and role (feature 007, spec FR-034). No email or phone number is kept: contact
// details live on the contact, and nobody who is not already a contact has any held.

export const ParticipantSchema = z
  .object({
    side: z.enum(["buyer", "delivery"]),
    displayName: z.string().trim().min(2).max(120),
    roleTitle: z.string().trim().max(120).optional(),
    contactId: z.string().min(1).max(100).optional(),
  })
  .strict();

const looksLikeContactDetail = (text: string): boolean =>
  text.includes("@") || (text.match(/\d/g)?.length ?? 0) >= 7;

export class ParticipantService {
  constructor(private readonly db: SqliteDatabase) {}

  add(actor: CatalogueActor, workshopId: string, raw: unknown): ParticipantView {
    const input = parseOrThrow(ParticipantSchema, raw);
    return audited(
      this.db,
      actor,
      "workshop.participant.add.refused",
      "workshop",
      workshopId,
      () => {
        requirePermission(actor, "workshops.edit");
        const texts = [input.displayName, input.roleTitle ?? ""];
        guardFreeText({ displayName: input.displayName, roleTitle: input.roleTitle ?? "" });
        if (texts.some(looksLikeContactDetail)) {
          throw new CatalogueRefusal(
            422,
            "Contact detail not accepted",
            ["contact_detail_not_accepted"],
            [],
            "Give a name and a role only. Email addresses and phone numbers belong on a contact.",
          );
        }
        return this.db.transaction((tx) => {
          const workshop = workshopOr404(tx, workshopId);
          if (input.contactId && accountOfContact(tx, input.contactId) !== workshop.accountId) {
            throw new CatalogueRefusal(
              422,
              "Contact not accepted",
              ["contact_not_at_account"],
              [],
              "That contact does not belong to this workshop's account.",
            );
          }
          const row: ParticipantRow = {
            id: uuidv7(),
            workshopId,
            side: input.side,
            displayName: input.displayName,
            roleTitle: input.roleTitle || null,
            contactId: input.contactId ?? null,
            userId: null,
            addedBy: actor.userId as string,
            addedAt: nowOf(actor).toISOString(),
            removedAt: null,
            removedBy: null,
          };
          insertParticipant(tx, row);
          auditChange(
            tx,
            actor,
            "workshop.participant.add",
            { type: "workshop", id: workshopId },
            { participant_id: row.id, side: row.side },
          );
          return participantView(row);
        });
      },
    );
  }

  remove(actor: CatalogueActor, workshopId: string, participantId: string): ParticipantView {
    return audited(
      this.db,
      actor,
      "workshop.participant.remove.refused",
      "workshop",
      workshopId,
      () => {
        requirePermission(actor, "workshops.edit");
        return this.db.transaction((tx) => {
          workshopOr404(tx, workshopId);
          const row = getParticipant(tx, participantId);
          if (!row || row.workshopId !== workshopId) {
            throw new CatalogueRefusal(404, "Not found", ["unknown_participant"]);
          }
          if (row.removedAt !== null) {
            throw new CatalogueRefusal(
              409,
              "Already removed",
              ["already_removed"],
              [],
              "That participant has already been removed.",
            );
          }
          markParticipantRemoved(
            tx,
            participantId,
            actor.userId as string,
            nowOf(actor).toISOString(),
          );
          auditChange(
            tx,
            actor,
            "workshop.participant.remove",
            { type: "workshop", id: workshopId },
            { participant_id: participantId },
          );
          return participantView(getParticipant(tx, participantId) as ParticipantRow);
        });
      },
    );
  }
}
