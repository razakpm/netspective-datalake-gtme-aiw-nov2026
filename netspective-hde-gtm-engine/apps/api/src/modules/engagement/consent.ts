import type { SqliteDatabase, Tx } from "@gtm/db";
import type { ConsentState } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import type { ConsentReader } from "../offers/index.js";

// Consent records (feature 006, spec FR-017, research R-09). Append-only: the current permission for a
// person is the latest row for their contact or their keyed email hash, and a withdrawal is a new row.

export function recordConsent(
  tx: Tx,
  c: {
    requestId: string;
    contactId: string | null;
    emailHash: string;
    noticeVersionId: string;
    consentGiven: boolean;
    at: string;
  },
): string {
  const id = uuidv7();
  tx.prepare(
    `INSERT INTO consent_record (id, request_id, contact_id, email_hash, notice_version_id, consent_given, recorded_at)
     VALUES (?,?,?,?,?,?,?)`,
  ).run(id, c.requestId, c.contactId, c.emailHash, c.noticeVersionId, c.consentGiven ? 1 : 0, c.at);
  return id;
}

/** The routing context's consent port, read from the consent records. */
export class ConsentLookup implements ConsentReader {
  constructor(private readonly db: SqliteDatabase) {}
  latest(who: { contactId: string | null; emailHash: string | null }): ConsentState {
    const r = this.db.raw
      .prepare(
        `SELECT consent_given FROM consent_record
         WHERE (? IS NOT NULL AND contact_id = ?) OR (? IS NOT NULL AND email_hash = ?)
         ORDER BY recorded_at DESC, rowid DESC LIMIT 1`,
      )
      .get(who.contactId, who.contactId, who.emailHash, who.emailHash) as
      { consent_given: number } | undefined;
    if (!r) return "none";
    return r.consent_given === 1 ? "given" : "not_given";
  }
}
