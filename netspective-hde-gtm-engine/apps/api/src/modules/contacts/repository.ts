import type { Tx } from "@gtm/db";
import type { SuppressionRecordLike } from "@gtm/domain";

// Persistence for contacts and suppression (feature 002 slice, built in feature 006). SQL only.

interface SuppressionRow {
  id: string;
  scope: "contact" | "account";
  contact_id: string | null;
  account_id: string | null;
  email_hash: string | null;
  action: "add" | "lift" | "erase_marker";
  recorded_at: string;
}

const toLike = (r: SuppressionRow): SuppressionRecordLike => ({
  id: r.id,
  scope: r.scope,
  contactId: r.contact_id,
  accountId: r.account_id,
  emailHash: r.email_hash,
  action: r.action,
  recordedAt: r.recorded_at,
});

/** Every record that could apply to the subject: its contact, its keyed hash and its account. */
export function suppressionRecordsFor(
  tx: Tx,
  who: { contactId: string | null; accountId: string | null; emailHash: string | null },
): SuppressionRecordLike[] {
  return (
    tx
      .prepare(
        `SELECT id, scope, contact_id, account_id, email_hash, action, recorded_at FROM suppression_record
         WHERE (? IS NOT NULL AND contact_id = ?) OR (? IS NOT NULL AND email_hash = ?)
            OR (? IS NOT NULL AND account_id = ?)`,
      )
      .all(
        who.contactId,
        who.contactId,
        who.emailHash,
        who.emailHash,
        who.accountId,
        who.accountId,
      ) as unknown as SuppressionRow[]
  ).map(toLike);
}

export function insertSuppression(
  tx: Tx,
  r: {
    id: string;
    scope: "contact" | "account";
    contactId: string | null;
    accountId: string | null;
    emailHash: string | null;
    action: "add" | "lift" | "erase_marker";
    reason: string;
    recordedBy: string;
    recordedAt: string;
  },
): void {
  tx.prepare(
    `INSERT INTO suppression_record (id, scope, contact_id, account_id, email_hash, action, reason, recorded_by, recorded_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    r.id,
    r.scope,
    r.contactId,
    r.accountId,
    r.emailHash,
    r.action,
    r.reason,
    r.recordedBy,
    r.recordedAt,
  );
}

export interface ContactRow {
  id: string;
  businessEmail: string | null;
  emailHash: string | null;
  erasedAt: string | null;
}

export function contactByEmail(tx: Tx, email: string): ContactRow | undefined {
  const r = tx
    .prepare(
      "SELECT id, business_email, email_hash, erased_at FROM contact WHERE business_email = ?",
    )
    .get(email) as
    | {
        id: string;
        business_email: string | null;
        email_hash: string | null;
        erased_at: string | null;
      }
    | undefined;
  return r
    ? { id: r.id, businessEmail: r.business_email, emailHash: r.email_hash, erasedAt: r.erased_at }
    : undefined;
}

export function contactById(tx: Tx, id: string): ContactRow | undefined {
  const r = tx
    .prepare("SELECT id, business_email, email_hash, erased_at FROM contact WHERE id = ?")
    .get(id) as
    | {
        id: string;
        business_email: string | null;
        email_hash: string | null;
        erased_at: string | null;
      }
    | undefined;
  return r
    ? { id: r.id, businessEmail: r.business_email, emailHash: r.email_hash, erasedAt: r.erased_at }
    : undefined;
}

export function insertContact(
  tx: Tx,
  c: { id: string; email: string; emailHash: string; now: string },
): void {
  tx.prepare(
    "INSERT INTO contact (id, full_name, business_email, email_hash, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?)",
  ).run(c.id, c.email, c.emailHash, c.now, c.now);
}

export function insertContactSource(
  tx: Tx,
  s: {
    id: string;
    contactId: string;
    source: string;
    basis: string;
    documentedOrigin: string;
    recordedBy: string | null;
    recordedAt: string;
  },
): void {
  tx.prepare(
    `INSERT INTO contact_source (id, contact_id, source, basis, documented_origin, recorded_by, recorded_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(s.id, s.contactId, s.source, s.basis, s.documentedOrigin, s.recordedBy, s.recordedAt);
}

export function activeRelationship(
  tx: Tx,
  accountId: string,
  contactId: string,
): { id: string } | undefined {
  return tx
    .prepare(
      "SELECT id FROM account_contact_relationship WHERE account_id = ? AND contact_id = ? AND ended_at IS NULL",
    )
    .get(accountId, contactId) as { id: string } | undefined;
}

export function insertRelationship(
  tx: Tx,
  r: { id: string; accountId: string; contactId: string; title: string | null; now: string },
): void {
  tx.prepare(
    `INSERT INTO account_contact_relationship (id, account_id, contact_id, title_stated, started_at)
     VALUES (?,?,?,?,?)`,
  ).run(r.id, r.accountId, r.contactId, r.title, r.now);
}

export function activeConfigValues(tx: Tx, list: string): string[] {
  return (
    tx.prepare("SELECT value FROM config_list WHERE list = ? AND active = 1").all(list) as {
      value: string;
    }[]
  ).map((r) => r.value);
}

/** A contact's latest permitted-use basis from feature 002, or null when none is recorded. */
export function latestBasis(tx: Tx, contactId: string): string | null {
  const r = tx
    .prepare(
      "SELECT basis FROM contact_source WHERE contact_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT 1",
    )
    .get(contactId) as { basis: string } | undefined;
  return r?.basis ?? null;
}

/** The contact's account through its active relationship, if any. */
export function accountOfContact(tx: Tx, contactId: string): string | null {
  const r = tx
    .prepare(
      "SELECT account_id FROM account_contact_relationship WHERE contact_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",
    )
    .get(contactId) as { account_id: string } | undefined;
  return r?.account_id ?? null;
}

/** The stakeholder role as confirmed, else as inferred, for the contact at the account; null when unknown. */
export function buyerRoleOf(tx: Tx, accountId: string, contactId: string): string | null {
  const r = tx
    .prepare(
      `SELECT role_confirmed, role_inferred FROM account_contact_relationship
       WHERE account_id = ? AND contact_id = ? AND ended_at IS NULL`,
    )
    .get(accountId, contactId) as
    { role_confirmed: string | null; role_inferred: string | null } | undefined;
  return r?.role_confirmed ?? r?.role_inferred ?? null;
}
