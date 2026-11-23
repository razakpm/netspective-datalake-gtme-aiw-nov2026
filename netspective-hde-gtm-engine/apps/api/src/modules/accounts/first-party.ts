import type { Tx } from "@gtm/db";
import {
  normaliseDomain,
  normaliseName,
  toAccountCreatedPayload,
  type ActorType,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { writeOutbox } from "../../platform/events/outbox.js";
import { recordAudit } from "../audit/index.js";

// Accounts reached through a first-party form (feature 006 slice of feature 002 US1). A visitor's
// organisation is matched to an existing account by its (unshared) domain; with no match an account is
// created with its source recorded. Duplicate detection against similar names stays with feature 002.

export interface FormAccountContext {
  actorId: string | null;
  actorType: ActorType;
  correlationId: string | null;
  now?: (() => Date) | undefined;
}

export interface FormAccountResult {
  accountId: string;
  created: boolean;
  /** The organisation type the visitor gave differs from the one on file. */
  orgTypeDiffers: boolean;
}

export function resolveAccountForForm(
  tx: Tx,
  input: { domain: string; orgName: string; orgType: string },
  ctx: FormAccountContext,
): FormAccountResult {
  const domain = normaliseDomain(input.domain) ?? input.domain.toLowerCase();
  const found = tx
    .prepare(
      `SELECT a.id FROM account a JOIN account_domain d ON d.account_id = a.id
       WHERE d.domain = ? AND d.is_shared = 0 AND a.merged_into IS NULL ORDER BY a.created_at, a.id LIMIT 1`,
    )
    .get(domain) as { id: string } | undefined;
  if (found) {
    const current = tx
      .prepare(
        "SELECT org_type FROM account_classification WHERE account_id = ? ORDER BY rowid DESC LIMIT 1",
      )
      .get(found.id) as { org_type: string } | undefined;
    return {
      accountId: found.id,
      created: false,
      orgTypeDiffers:
        input.orgType !== "unknown" && current !== undefined && current.org_type !== input.orgType,
    };
  }

  const now = (ctx.now ?? (() => new Date()))();
  const at = now.toISOString();
  const id = uuidv7();
  tx.prepare(
    `INSERT INTO account (id, name, name_normalised, geography, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?)`,
  ).run(id, input.orgName, normaliseName(input.orgName), ctx.actorId, at, at);
  tx.prepare(
    "INSERT INTO account_domain (id, account_id, domain, is_shared, created_at) VALUES (?,?,?,0,?)",
  ).run(uuidv7(), id, domain, at);
  tx.prepare(
    `INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_by, recorded_at)
     VALUES (?,?,?,NULL,?,?)`,
  ).run(uuidv7(), id, input.orgType, ctx.actorId, at);
  recordAudit(
    tx,
    {
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      action: "account.create",
      entityType: "account",
      entityId: id,
      outcome: "success",
      after: { org_type: input.orgType, source: "first_party_form" },
      correlationId: ctx.correlationId,
    },
    ctx.now,
  );
  writeOutbox(
    tx,
    {
      type: "account.created",
      actor: { id: ctx.actorId, type: ctx.actorType },
      correlation_id: ctx.correlationId,
      causation_id: null,
      idempotency_key: null,
      payload: toAccountCreatedPayload({
        account_id: id,
        org_type: input.orgType,
        source: "first_party_form",
      }),
      provenance: { source: "first_party_form" },
    },
    ctx.now,
  );
  return { accountId: id, created: true, orgTypeDiffers: false };
}
