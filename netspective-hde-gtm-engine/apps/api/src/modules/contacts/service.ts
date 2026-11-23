import type { SqliteDatabase, Tx } from "@gtm/db";
import { keyedEmailHash, validateContact, type ActorType } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import {
  activeConfigValues,
  activeRelationship,
  contactByEmail,
  insertContact,
  insertContactSource,
  insertRelationship,
} from "./repository.js";

// Contact find-or-create by business email through the first-party form (feature 002 US2 slice, built in
// feature 006). It runs inside the caller's transaction so the request, the contact and the audit record
// commit together. CSV import, roles and erasure stay in feature 002.

export interface ContactsSettings {
  /** Key for the keyed email hash used by suppression and consent lookups. */
  hashKey: string;
}

export interface WriteContext {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export type FindOrCreate =
  | { ok: true; contactId: string; created: boolean; emailHash: string; domain: string }
  | { ok: false; code: "email_invalid" | "personal_email" | "role_too_long" };

export class ContactsService {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly settings: ContactsSettings,
  ) {}

  emailHash(email: string): string {
    return keyedEmailHash(email, this.settings.hashKey);
  }

  personalDomains(tx: Tx = this.db.raw): ReadonlySet<string> {
    return new Set(activeConfigValues(tx, "personal_domain"));
  }

  /** Business contact only: a personal address is refused, never stored as a contact. */
  findOrCreateByBusinessEmail(
    tx: Tx,
    input: {
      email: string;
      role: string;
      accountId: string;
      source: "first_party_form";
      basis: string;
      documentedOrigin: string;
    },
    ctx: WriteContext,
  ): FindOrCreate {
    const check = validateContact(
      { email: input.email, role: input.role },
      this.personalDomains(tx),
    );
    if (!check.ok) return check;
    const now = (ctx.now ?? (() => new Date()))().toISOString();
    const emailHash = this.emailHash(check.email);

    const existing = contactByEmail(tx, check.email);
    if (existing) {
      if (!activeRelationship(tx, input.accountId, existing.id)) {
        insertRelationship(tx, {
          id: uuidv7(),
          accountId: input.accountId,
          contactId: existing.id,
          title: check.role,
          now,
        });
      }
      return { ok: true, contactId: existing.id, created: false, emailHash, domain: check.domain };
    }

    const id = uuidv7();
    insertContact(tx, { id, email: check.email, emailHash, now });
    insertContactSource(tx, {
      id: uuidv7(),
      contactId: id,
      source: input.source,
      basis: input.basis,
      documentedOrigin: input.documentedOrigin,
      recordedBy: ctx.actorId,
      recordedAt: now,
    });
    insertRelationship(tx, {
      id: uuidv7(),
      accountId: input.accountId,
      contactId: id,
      title: check.role,
      now,
    });
    recordAudit(
      tx,
      {
        actorId: ctx.actorId,
        actorType: ctx.actorType,
        action: "contact.create",
        entityType: "contact",
        entityId: id,
        outcome: "success",
        after: { source: input.source, basis: input.basis },
        correlationId: ctx.correlationId,
      },
      ctx.now,
    );
    return { ok: true, contactId: id, created: true, emailHash, domain: check.domain };
  }
}
