import type { SqliteDatabase, Tx } from "@gtm/db";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../audit/index.js";
import { pairKey, type ReviewItemRow } from "./review.js";
import { aliasesOf, currentClassification, domainsOf, getAccount } from "./repository.js";

// Merge and reject decisions on a merge candidate (spec FR-005, FR-006; research R-10). Nothing merges
// without a human decision and a reason. Every name, domain, relationship and note is kept; conflicting
// type, geography or bed count needs an explicit choice. The absorbed account is marked, not deleted.

export type FieldChoice = "a" | "b";
export const CONFLICT_FIELDS = ["org_type", "geography", "staffed_bed_count"] as const;

export interface DecisionInput {
  decision: "merge" | "reject";
  reason: string;
  survivorId?: string | undefined;
  fieldChoices?: Record<string, FieldChoice> | undefined;
}

export interface Actor {
  userId: string;
  correlationId: string | null;
  now?: () => Date;
}

export function getReviewItem(tx: Tx, id: string): ReviewItemRow {
  const row = tx.prepare("SELECT * FROM review_item WHERE id = ?").get(id) as
    ReviewItemRow | undefined;
  if (!row) throw new HttpError(404, "Not found", "No such review item");
  return row;
}

function auditReview(tx: Tx, actor: Actor, action: string, id: string, after: unknown): void {
  recordAudit(
    tx,
    {
      actorId: actor.userId,
      actorType: "human",
      action,
      entityType: "review_item",
      entityId: id,
      outcome: "success",
      after,
      correlationId: actor.correlationId,
    },
    actor.now,
  );
}

export function decideMerge(
  db: SqliteDatabase,
  itemId: string,
  input: DecisionInput,
  actor: Actor,
): ReviewItemRow {
  const now = actor.now ?? (() => new Date());
  return db.transaction((tx) => {
    const item = getReviewItem(tx, itemId);
    if (item.kind !== "merge_candidate")
      throw new HttpError(400, "Wrong item kind", "Not a merge candidate");
    if (item.state !== "open")
      throw new HttpError(409, "Already decided", "This review item was already decided");
    const at = now().toISOString();

    if (input.decision === "reject") {
      tx.prepare(
        "UPDATE review_item SET state = 'rejected', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?",
      ).run(actor.userId, at, input.reason, itemId);
      auditReview(tx, actor, "review.reject", itemId, { state: "rejected" });
      return getReviewItem(tx, itemId);
    }

    const a = item.subject_a;
    const b = item.subject_b!;
    if (input.survivorId !== a && input.survivorId !== b) {
      throw new HttpError(400, "Survivor required", "survivorId must be one of the two accounts");
    }
    const survivorId = input.survivorId;
    const absorbedId = survivorId === a ? b : a;
    const survivor = getAccount(tx, survivorId)!;
    const absorbed = getAccount(tx, absorbedId)!;
    if (survivor.merged_into || absorbed.merged_into) {
      throw new HttpError(409, "Account already merged", "One of the accounts was merged already");
    }

    // Conflicting scalar fields need an explicit choice (nothing is dropped silently).
    const side = (id: string) => {
      const c = currentClassification(tx, id);
      return {
        org_type: c.orgType === "unknown" ? null : c.orgType,
        staffed_bed_count: c.staffedBedCount,
        geography: getAccount(tx, id)!.geography,
      };
    };
    const va = side(a);
    const vb = side(b);
    const choose = <K extends keyof typeof va>(field: K): (typeof va)[K] => {
      const x = va[field];
      const y = vb[field];
      if (x === null) return y;
      if (y === null || x === y) return x;
      const choice = input.fieldChoices?.[field];
      if (choice !== "a" && choice !== "b") {
        throw new HttpError(400, "Choice required", `Choose which value to keep for ${field}`);
      }
      return choice === "a" ? x : y;
    };
    const orgType = choose("org_type");
    const beds = choose("staffed_bed_count");
    const geography = choose("geography");

    // Names: the absorbed name and aliases become aliases of the survivor.
    const haveAliases = new Set(aliasesOf(tx, survivorId).map((x) => x.alias));
    const addAlias = (alias: string, normalised: string) => {
      if (haveAliases.has(alias) || normalised === survivor.name_normalised) return;
      haveAliases.add(alias);
      tx.prepare(
        "INSERT OR IGNORE INTO account_alias (id, account_id, alias, alias_normalised, source, created_at) VALUES (?,?,?,?,?,?)",
      ).run(uuidv7(), survivorId, alias, normalised, "merge", at);
    };
    addAlias(absorbed.name, absorbed.name_normalised);
    for (const row of tx
      .prepare("SELECT alias, alias_normalised FROM account_alias WHERE account_id = ?")
      .all(absorbedId) as {
      alias: string;
      alias_normalised: string;
    }[]) {
      addAlias(row.alias, row.alias_normalised);
    }

    // Domains (keep the shared flag if either side had it).
    const haveDomains = new Map(domainsOf(tx, survivorId).map((d) => [d.domain, d.shared]));
    for (const d of domainsOf(tx, absorbedId)) {
      if (haveDomains.has(d.domain)) {
        if (d.shared)
          tx.prepare(
            "UPDATE account_domain SET is_shared = 1 WHERE account_id = ? AND domain = ?",
          ).run(survivorId, d.domain);
      } else {
        tx.prepare(
          "INSERT INTO account_domain (id, account_id, domain, is_shared, created_at) VALUES (?,?,?,?,?)",
        ).run(uuidv7(), survivorId, d.domain, d.shared ? 1 : 0, at);
      }
    }

    // Notes are concatenated, never dropped.
    const notes = [survivor.notes, absorbed.notes]
      .filter((n): n is string => !!n && n.trim() !== "")
      .join("\n\n");
    tx.prepare("UPDATE account SET geography = ?, notes = ?, updated_at = ? WHERE id = ?").run(
      geography,
      notes === "" ? null : notes,
      at,
      survivorId,
    );

    const current = currentClassification(tx, survivorId);
    if ((orgType ?? "unknown") !== current.orgType || beds !== current.staffedBedCount) {
      tx.prepare(
        "INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_by, recorded_at) VALUES (?,?,?,?,?,?)",
      ).run(uuidv7(), survivorId, orgType ?? "unknown", beds, actor.userId, at);
    }

    // Contact relationships move to the survivor; a duplicate pair is ended rather than dropped.
    const rels = tx
      .prepare(
        "SELECT id, contact_id FROM account_contact_relationship WHERE account_id = ? AND ended_at IS NULL",
      )
      .all(absorbedId) as {
      id: string;
      contact_id: string;
    }[];
    for (const rel of rels) {
      const dup = tx
        .prepare(
          "SELECT 1 FROM account_contact_relationship WHERE account_id = ? AND contact_id = ? AND ended_at IS NULL",
        )
        .get(survivorId, rel.contact_id);
      if (dup) {
        tx.prepare(
          "UPDATE account_contact_relationship SET ended_at = ?, end_reason = 'merged duplicate relationship' WHERE id = ?",
        ).run(at, rel.id);
      } else {
        tx.prepare("UPDATE account_contact_relationship SET account_id = ? WHERE id = ?").run(
          survivorId,
          rel.id,
        );
      }
    }

    // Account-scope suppression carries over to the survivor (FR-043).
    const suppressed = tx
      .prepare(
        `SELECT reason FROM suppression_record s WHERE scope = 'account' AND account_id = ? AND action = 'add'
         AND NOT EXISTS (SELECT 1 FROM suppression_record l WHERE l.scope = 'account' AND l.account_id = s.account_id
           AND l.action = 'lift' AND l.rowid > s.rowid) ORDER BY rowid DESC LIMIT 1`,
      )
      .get(absorbedId) as { reason: string } | undefined;
    if (suppressed) {
      tx.prepare(
        "INSERT INTO suppression_record (id, scope, account_id, action, reason, recorded_by, recorded_at) VALUES (?,?,?,?,?,?,?)",
      ).run(
        uuidv7(),
        "account",
        survivorId,
        "add",
        `Carried over from merged account: ${suppressed.reason}`,
        actor.userId,
        at,
      );
    }

    tx.prepare("UPDATE account SET merged_into = ?, updated_at = ? WHERE id = ?").run(
      survivorId,
      at,
      absorbedId,
    );

    // Other open items that mention the absorbed account now point at the survivor.
    const others = tx
      .prepare(
        "SELECT * FROM review_item WHERE state = 'open' AND id <> ? AND (subject_a = ? OR subject_b = ?)",
      )
      .all(itemId, absorbedId, absorbedId) as unknown as ReviewItemRow[];
    for (const other of others) {
      const na = other.subject_a === absorbedId ? survivorId : other.subject_a;
      const nb = other.subject_b === absorbedId ? survivorId : other.subject_b;
      if (nb !== null && na === nb) {
        tx.prepare(
          "UPDATE review_item SET state = 'rejected', decided_by = ?, decided_at = ?, decision_reason = 'resolved by merge' WHERE id = ?",
        ).run(actor.userId, at, other.id);
      } else if (other.kind === "merge_candidate" && nb !== null) {
        tx.prepare(
          "UPDATE review_item SET subject_a = ?, subject_b = ?, pair_key = ? WHERE id = ?",
        ).run(na, nb, pairKey(na, nb), other.id);
      } else {
        tx.prepare("UPDATE review_item SET subject_a = ?, subject_b = ? WHERE id = ?").run(
          na,
          nb,
          other.id,
        );
      }
    }

    tx.prepare(
      "UPDATE review_item SET state = 'merged', decided_by = ?, decided_at = ?, decision_reason = ? WHERE id = ?",
    ).run(actor.userId, at, input.reason, itemId);
    recordAudit(
      tx,
      {
        actorId: actor.userId,
        actorType: "human",
        action: "account.merge",
        entityType: "account",
        entityId: survivorId,
        outcome: "success",
        before: { absorbed: absorbedId },
        after: { survivor: survivorId, review_item: itemId },
        correlationId: actor.correlationId,
      },
      now,
    );
    return getReviewItem(tx, itemId);
  });
}
