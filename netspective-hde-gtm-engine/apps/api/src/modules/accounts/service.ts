import type { SqliteDatabase } from "@gtm/db";
import { isOrgType, normaliseDomain, normaliseName, type OrgType } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";
import type { Actor } from "./merge.js";
import {
  aliasesOf,
  currentClassification,
  domainsOf,
  getAccount,
  type AccountRow,
} from "./repository.js";

// Account reads and edits (tasks T032; spec FR-009, FR-040a). Editing the bed count or type is audited
// and never triggers an assessment.

export interface AccountSummary {
  id: string;
  name: string;
  orgType: OrgType;
  geography?: string;
  fit: Record<string, string>;
  priorityEligible: boolean;
  suppressed: boolean;
}

export interface AccountDetail extends AccountSummary {
  notes?: string;
  staffedBedCount: number | null;
  aliases: { alias: string; currentUntil: string | null }[];
  domains: { domain: string; shared: boolean }[];
  classificationHistory: {
    orgType: OrgType;
    staffedBedCount: number | null;
    recordedBy: string | null;
    recordedAt: string;
  }[];
  override: null | {
    action: "grant" | "revoke";
    rationale: string;
    decidedBy: string;
    decidedAt: string;
  };
}

export interface AccountUpdate {
  name?: string | undefined;
  geography?: string | undefined;
  notes?: string | undefined;
  orgType?: OrgType | undefined;
  staffedBedCount?: number | null | undefined;
}

/** Views that later features enrich (fit, eligibility, suppression); defaults until they are wired in. */
export interface AccountViewHooks {
  fit(accountId: string): Record<string, string>;
  priorityEligible(accountId: string): boolean;
  suppressed(accountId: string): boolean;
  override(accountId: string): AccountDetail["override"];
}

const NO_HOOKS: AccountViewHooks = {
  fit: () => ({}),
  priorityEligible: () => false,
  suppressed: () => false,
  override: () => null,
};

export class AccountService {
  constructor(
    private readonly db: SqliteDatabase,
    private hooks: AccountViewHooks = NO_HOOKS,
  ) {}

  setHooks(hooks: AccountViewHooks): void {
    this.hooks = hooks;
  }

  private summary(account: AccountRow): AccountSummary {
    const c = currentClassification(this.db.raw, account.id);
    return {
      id: account.id,
      name: account.name,
      orgType: c.orgType,
      ...(account.geography ? { geography: account.geography } : {}),
      fit: this.hooks.fit(account.id),
      priorityEligible: this.hooks.priorityEligible(account.id),
      suppressed: this.hooks.suppressed(account.id),
    };
  }

  list(query: {
    orgType?: string | undefined;
    fit?: string | undefined;
    eligible?: boolean | undefined;
    q?: string | undefined;
    cursor?: string | undefined;
    limit?: number | undefined;
  }): { items: AccountSummary[]; nextCursor: string | null } {
    const limit = query.limit ?? 50;
    const rows = this.db.raw
      .prepare("SELECT * FROM account WHERE merged_into IS NULL AND id > ? ORDER BY id")
      .all(query.cursor ?? "") as unknown as AccountRow[];
    const q = query.q?.trim().toLowerCase();
    const out: AccountSummary[] = [];
    let next: string | null = null;
    for (const row of rows) {
      if (q) {
        const aliasHit = aliasesOf(this.db.raw, row.id).some((a) =>
          a.alias.toLowerCase().includes(q),
        );
        if (!row.name.toLowerCase().includes(q) && !aliasHit) continue;
      }
      const summary = this.summary(row);
      if (query.orgType && summary.orgType !== query.orgType) continue;
      if (query.fit && !Object.values(summary.fit).includes(query.fit)) continue;
      if (query.eligible !== undefined && summary.priorityEligible !== query.eligible) continue;
      if (out.length === limit) {
        next = out[out.length - 1]!.id;
        break;
      }
      out.push(summary);
    }
    return { items: out, nextCursor: next };
  }

  get(id: string): AccountDetail {
    const account = getAccount(this.db.raw, id);
    if (!account || account.merged_into) throw new HttpError(404, "Not found", "No such account");
    const history = this.db.raw
      .prepare(
        "SELECT org_type, staffed_bed_count, recorded_by, recorded_at FROM account_classification WHERE account_id = ? ORDER BY rowid DESC",
      )
      .all(id) as {
      org_type: OrgType;
      staffed_bed_count: number | null;
      recorded_by: string | null;
      recorded_at: string;
    }[];
    const current = currentClassification(this.db.raw, id);
    return {
      ...this.summary(account),
      ...(account.notes ? { notes: account.notes } : {}),
      staffedBedCount: current.staffedBedCount,
      aliases: aliasesOf(this.db.raw, id),
      domains: domainsOf(this.db.raw, id),
      classificationHistory: history.map((h) => ({
        orgType: h.org_type,
        staffedBedCount: h.staffed_bed_count,
        recordedBy: h.recorded_by,
        recordedAt: h.recorded_at,
      })),
      override: this.hooks.override(id),
    };
  }

  update(id: string, input: AccountUpdate, actor: Actor): AccountDetail {
    const now = actor.now ?? (() => new Date());
    this.db.transaction((tx) => {
      const account = getAccount(tx, id);
      if (!account || account.merged_into) throw new HttpError(404, "Not found", "No such account");
      const at = now().toISOString();
      const changed: string[] = [];

      let name = account.name;
      let normalised = account.name_normalised;
      if (input.name !== undefined && normaliseName(input.name) !== account.name_normalised) {
        // Rename keeps identity; the former name stays as an alias with the date it stopped being current.
        tx.prepare(
          "INSERT OR IGNORE INTO account_alias (id, account_id, alias, alias_normalised, current_until, source, created_at) VALUES (?,?,?,?,?,?,?)",
        ).run(uuidv7(), id, account.name, account.name_normalised, at, "rename", at);
        name = input.name.trim();
        normalised = normaliseName(name);
        changed.push("name");
      }
      const geography =
        input.geography !== undefined ? input.geography.trim() || null : account.geography;
      const notes = input.notes !== undefined ? input.notes.trim() || null : account.notes;
      if (geography !== account.geography) changed.push("geography");
      if (notes !== account.notes) changed.push("notes");
      if (changed.length > 0) {
        tx.prepare(
          "UPDATE account SET name = ?, name_normalised = ?, geography = ?, notes = ?, updated_at = ? WHERE id = ?",
        ).run(name, normalised, geography, notes, at, id);
      }

      const current = currentClassification(tx, id);
      const nextType = input.orgType ?? current.orgType;
      const nextBeds =
        input.staffedBedCount !== undefined ? input.staffedBedCount : current.staffedBedCount;
      if (input.orgType !== undefined && !isOrgType(input.orgType)) {
        throw new HttpError(400, "Invalid organisation type", "Unknown organisation type");
      }
      if (nextType !== current.orgType || nextBeds !== current.staffedBedCount) {
        tx.prepare(
          "INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_by, recorded_at) VALUES (?,?,?,?,?,?)",
        ).run(uuidv7(), id, nextType, nextBeds, actor.userId, at);
        if (nextType !== current.orgType) changed.push("org_type");
        if (nextBeds !== current.staffedBedCount) changed.push("staffed_bed_count");
      }
      if (changed.length > 0) {
        recordAudit(
          tx,
          {
            actorId: actor.userId,
            actorType: "human",
            action: "account.update",
            entityType: "account",
            entityId: id,
            outcome: "success",
            after: { changed },
            correlationId: actor.correlationId,
          },
          now,
        );
      }
    });
    return this.get(id);
  }

  setDomainShared(id: string, rawDomain: string, shared: boolean, actor: Actor): void {
    const now = actor.now ?? (() => new Date());
    const domain = normaliseDomain(rawDomain);
    if (domain === null) throw new HttpError(400, "Invalid domain", "Not a valid hostname");
    this.db.transaction((tx) => {
      const found = tx
        .prepare("SELECT 1 FROM account_domain WHERE account_id = ? AND domain = ?")
        .get(id, domain);
      if (!found) throw new HttpError(404, "Not found", "The account does not have this domain");
      tx.prepare("UPDATE account_domain SET is_shared = ? WHERE account_id = ? AND domain = ?").run(
        shared ? 1 : 0,
        id,
        domain,
      );
      recordAudit(
        tx,
        {
          actorId: actor.userId,
          actorType: "human",
          action: "account.domain.shared",
          entityType: "account",
          entityId: id,
          outcome: "success",
          after: { shared },
          correlationId: actor.correlationId,
        },
        now,
      );
    });
  }
}
