import type { SqliteDatabase } from "@gtm/db";
import type { PriorInteractions } from "../offers/index.js";

// Prior first-party interactions for the routing context (feature 006): how many times the account has
// downloaded the register or asked for a working session. Counts only; they inform an explanation and are
// never intent.
export class PriorLookup implements PriorInteractions {
  constructor(private readonly db: SqliteDatabase) {}
  forAccount(accountId: string): { downloads: number; sessionRequests: number } {
    const count = (sql: string) => (this.db.raw.prepare(sql).get(accountId) as { c: number }).c;
    return {
      downloads: count("SELECT count(*) c FROM lead_magnet_download WHERE account_id = ?"),
      sessionRequests: count(
        "SELECT count(*) c FROM offer_request WHERE account_id = ? AND kind = 'working_session'",
      ),
    };
  }
}
