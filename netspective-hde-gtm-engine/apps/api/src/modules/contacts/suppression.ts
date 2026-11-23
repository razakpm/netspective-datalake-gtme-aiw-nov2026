import type { SqliteDatabase, Tx } from "@gtm/db";
import { suppressionStatus, type SuppressionStatus } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { parseOrThrow } from "../../http/errors.js";
import {
  audited,
  CatalogueRefusal,
  guardFreeText,
  nowOf,
  type CatalogueActor,
} from "../../platform/catalogue.js";
import { recordAudit } from "../audit/index.js";
import { insertSuppression, suppressionRecordsFor } from "./repository.js";

// Suppression: the single eligibility check and `addSuppression` (feature 002 slice, built in 006).
// Any signed-in person may add a suppression; lifting one belongs to feature 002 (administrators only).
// A suppression is never deleted.

export const SuppressionInputSchema = z
  .object({
    scope: z.enum(["contact", "account"]),
    contactId: z.string().min(1).optional(),
    accountId: z.string().min(1).optional(),
    emailHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional(),
    reason: z.string().min(3).max(300),
  })
  .strict();
export type SuppressionInput = z.infer<typeof SuppressionInputSchema>;

export interface SuppressionSubject {
  contactId?: string | null;
  accountId?: string | null;
  emailHash?: string | null;
}

/** The one check every feature that contacts people calls (002 FR-044). */
export function checkSuppression(tx: Tx, who: SuppressionSubject): SuppressionStatus {
  const subject = {
    contactId: who.contactId ?? null,
    accountId: who.accountId ?? null,
    emailHash: who.emailHash ?? null,
  };
  return suppressionStatus(subject, suppressionRecordsFor(tx, subject));
}

export class SuppressionService {
  constructor(private readonly db: SqliteDatabase) {}

  isSuppressed(who: SuppressionSubject): SuppressionStatus {
    return checkSuppression(this.db.raw, who);
  }

  add(actor: CatalogueActor, raw: unknown): { id: string } {
    return audited(this.db, actor, "suppression.add", "suppression", null, () => {
      const input = parseOrThrow(SuppressionInputSchema, raw);
      guardFreeText({ reason: input.reason });
      if (actor.actorType !== "human" || actor.userId === null) {
        throw new CatalogueRefusal(
          403,
          "Not permitted",
          ["forbidden"],
          [],
          "Only a person can add a suppression.",
        );
      }
      const target =
        input.scope === "contact"
          ? input.contactId !== undefined || input.emailHash !== undefined
          : input.accountId !== undefined;
      if (!target)
        throw new CatalogueRefusal(422, "Suppression target missing", ["target_required"]);
      const id = uuidv7();
      const at = nowOf(actor).toISOString();
      this.db.transaction((tx) => {
        insertSuppression(tx, {
          id,
          scope: input.scope,
          contactId: input.scope === "contact" ? (input.contactId ?? null) : null,
          accountId: input.scope === "account" ? (input.accountId ?? null) : null,
          emailHash: input.scope === "contact" ? (input.emailHash ?? null) : null,
          action: "add",
          reason: input.reason,
          recordedBy: actor.userId as string,
          recordedAt: at,
        });
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: actor.actorType,
            action: "suppression.add",
            entityType: "suppression",
            entityId: id,
            outcome: "success",
            after: { scope: input.scope },
            correlationId: actor.correlationId,
          },
          actor.now,
        );
      });
      return { id };
    });
  }
}
