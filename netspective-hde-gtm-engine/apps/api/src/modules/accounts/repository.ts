import type { Tx } from "@gtm/db";
import type { MatchAccount, OrgType } from "@gtm/domain";

// Account reads shared by import, merge, routes and (later) the ICP assessment (task T018). Every
// function takes a Tx; writes happen only in the audited service functions.

export interface AccountRow {
  id: string;
  name: string;
  name_normalised: string;
  geography: string | null;
  notes: string | null;
  merged_into: string | null;
  created_at: string;
  updated_at: string;
}

export interface Classification {
  orgType: OrgType;
  staffedBedCount: number | null;
}

export function getAccount(tx: Tx, id: string): AccountRow | undefined {
  return tx.prepare("SELECT * FROM account WHERE id = ?").get(id) as AccountRow | undefined;
}

export function currentClassification(tx: Tx, accountId: string): Classification {
  const row = tx
    .prepare(
      "SELECT org_type, staffed_bed_count FROM account_classification WHERE account_id = ? ORDER BY rowid DESC LIMIT 1",
    )
    .get(accountId) as { org_type: OrgType; staffed_bed_count: number | null } | undefined;
  return { orgType: row?.org_type ?? "unknown", staffedBedCount: row?.staffed_bed_count ?? null };
}

export function aliasesOf(
  tx: Tx,
  accountId: string,
): { alias: string; currentUntil: string | null }[] {
  return (
    tx
      .prepare("SELECT alias, current_until FROM account_alias WHERE account_id = ? ORDER BY alias")
      .all(accountId) as { alias: string; current_until: string | null }[]
  ).map((r) => ({ alias: r.alias, currentUntil: r.current_until }));
}

export function domainsOf(tx: Tx, accountId: string): { domain: string; shared: boolean }[] {
  return (
    tx
      .prepare("SELECT domain, is_shared FROM account_domain WHERE account_id = ? ORDER BY domain")
      .all(accountId) as { domain: string; is_shared: number }[]
  ).map((r) => ({ domain: r.domain, shared: r.is_shared === 1 }));
}

export function toMatchAccount(tx: Tx, account: AccountRow): MatchAccount {
  const classification = currentClassification(tx, account.id);
  return {
    id: account.id,
    name: account.name,
    aliases: aliasesOf(tx, account.id).map((a) => a.alias),
    domains: domainsOf(tx, account.id),
    orgType: classification.orgType,
    geography: account.geography,
  };
}

/** All accounts that have not been merged away, as matching inputs. */
export function loadMatchAccounts(tx: Tx): MatchAccount[] {
  const rows = tx
    .prepare("SELECT * FROM account WHERE merged_into IS NULL ORDER BY id")
    .all() as unknown as AccountRow[];
  return rows.map((row) => toMatchAccount(tx, row));
}
