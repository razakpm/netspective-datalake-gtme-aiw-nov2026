import type { Tx } from "@gtm/db";
import {
  detectCandidates,
  guardValue,
  normaliseName,
  toAccountCreatedPayload,
  validateAccountRow,
  type AccountRow as ValidAccountRow,
  type CsvRow,
  type RawAccountRow,
} from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { recordAudit } from "../audit/index.js";
import { writeOutbox } from "../../platform/events/outbox.js";
import type { ImportContext, RowOutcome } from "../../platform/imports/service.js";
import { proposeMerge } from "./review.js";
import {
  aliasesOf,
  currentClassification,
  domainsOf,
  getAccount,
  loadMatchAccounts,
  toMatchAccount,
  type AccountRow,
} from "./repository.js";

// Organisation import (tasks T028; spec FR-001 to FR-010, FR-018). One row = one savepoint (the runner).
// Unchanged rows write nothing: no records, no audit, no timestamps (FR-007).

export const ACCOUNT_CSV = {
  required: ["name", "type"],
  optional: ["aliases", "domains", "geography", "notes", "staffed_beds"],
} as const;

function findExisting(tx: Tx, normalisedName: string): AccountRow | undefined {
  const byName = tx
    .prepare(
      "SELECT * FROM account WHERE name_normalised = ? AND merged_into IS NULL ORDER BY id LIMIT 1",
    )
    .get(normalisedName) as AccountRow | undefined;
  if (byName) return byName;
  // A former name still identifies the account (FR-009).
  return tx
    .prepare(
      `SELECT a.* FROM account a JOIN account_alias al ON al.account_id = a.id
       WHERE al.alias_normalised = ? AND a.merged_into IS NULL ORDER BY a.id LIMIT 1`,
    )
    .get(normalisedName) as AccountRow | undefined;
}

function addClassification(
  tx: Tx,
  accountId: string,
  orgType: string,
  beds: number | null,
  ctx: ImportContext,
): void {
  tx.prepare(
    `INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_by, recorded_at)
     VALUES (?,?,?,?,?,?)`,
  ).run(uuidv7(), accountId, orgType, beds, ctx.actorId, ctx.now().toISOString());
}

function insertAliases(
  tx: Tx,
  accountId: string,
  names: readonly string[],
  source: string,
  at: string,
): number {
  const have = new Set([
    normaliseName(getAccount(tx, accountId)?.name ?? ""),
    ...aliasesOf(tx, accountId).map((a) => normaliseName(a.alias)),
  ]);
  let added = 0;
  for (const alias of names) {
    const normalised = normaliseName(alias);
    if (normalised === "" || have.has(normalised)) continue;
    have.add(normalised);
    tx.prepare(
      "INSERT INTO account_alias (id, account_id, alias, alias_normalised, source, created_at) VALUES (?,?,?,?,?,?)",
    ).run(uuidv7(), accountId, alias, normalised, source, at);
    added++;
  }
  return added;
}

function insertDomains(tx: Tx, accountId: string, domains: readonly string[], at: string): number {
  const have = new Set(domainsOf(tx, accountId).map((d) => d.domain));
  let added = 0;
  for (const domain of domains) {
    if (have.has(domain)) continue;
    tx.prepare(
      "INSERT INTO account_domain (id, account_id, domain, is_shared, created_at) VALUES (?,?,?,0,?)",
    ).run(uuidv7(), accountId, domain, at);
    added++;
  }
  return added;
}

export function processAccountRow(tx: Tx, csvRow: CsvRow, ctx: ImportContext): RowOutcome {
  const rowNumber = csvRow.rowNumber;
  const reject = (...reasonCodes: string[]): RowOutcome => ({
    rowNumber,
    outcome: "rejected",
    reasonCodes,
  });

  // The PHI boundary comes first: a PHI-like row is rejected and none of its content is kept (FR-018).
  const guard = guardValue(csvRow.values);
  if (guard.decision !== "allow") return reject(...guard.rule_ids.map((id) => `phi_guard:${id}`));

  const result = validateAccountRow(csvRow.values as RawAccountRow);
  if (!result.ok) return reject(...result.reasons);
  const row = result.value;

  const existing = findExisting(tx, normaliseName(row.name));
  return existing
    ? updateExisting(tx, existing, row, rowNumber, ctx)
    : createNew(tx, row, rowNumber, ctx);
}

function updateExisting(
  tx: Tx,
  account: AccountRow,
  row: ValidAccountRow,
  rowNumber: number,
  ctx: ImportContext,
): RowOutcome {
  const at = ctx.now().toISOString();
  const changed: string[] = [];

  const aliasesAdded = insertAliases(tx, account.id, row.aliases, "import", at);
  if (aliasesAdded > 0) changed.push("aliases");
  if (insertDomains(tx, account.id, row.domains, at) > 0) changed.push("domains");

  let geography = account.geography;
  let notes = account.notes;
  if (row.geography !== null && row.geography !== account.geography) {
    geography = row.geography;
    changed.push("geography");
  }
  if (row.notes !== null && row.notes !== account.notes) {
    notes = row.notes;
    changed.push("notes");
  }
  if (geography !== account.geography || notes !== account.notes) {
    tx.prepare("UPDATE account SET geography = ?, notes = ?, updated_at = ? WHERE id = ?").run(
      geography,
      notes,
      at,
      account.id,
    );
  }

  const current = currentClassification(tx, account.id);
  const nextType = row.orgType !== "unknown" ? row.orgType : current.orgType;
  const nextBeds =
    row.staffedBedCount !== undefined ? row.staffedBedCount : current.staffedBedCount;
  if (nextType !== current.orgType || nextBeds !== current.staffedBedCount) {
    addClassification(tx, account.id, nextType, nextBeds, ctx);
    if (nextType !== current.orgType) changed.push("org_type");
    if (nextBeds !== current.staffedBedCount) changed.push("staffed_bed_count");
  }

  if (changed.length === 0)
    return { rowNumber, outcome: "unchanged", reasonCodes: [], entityId: account.id };
  recordAudit(
    tx,
    {
      actorId: ctx.actorId,
      actorType: "human",
      action: "account.update",
      entityType: "account",
      entityId: account.id,
      outcome: "success",
      after: { changed },
      correlationId: ctx.correlationId,
    },
    ctx.now,
  );
  return { rowNumber, outcome: "updated", reasonCodes: [], entityId: account.id };
}

function createNew(
  tx: Tx,
  row: ValidAccountRow,
  rowNumber: number,
  ctx: ImportContext,
): RowOutcome {
  const id = uuidv7();
  const at = ctx.now().toISOString();
  tx.prepare(
    `INSERT INTO account (id, name, name_normalised, geography, notes, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).run(id, row.name, normaliseName(row.name), row.geography, row.notes, ctx.actorId, at, at);
  insertAliases(tx, id, row.aliases, "import", at);
  insertDomains(tx, id, row.domains, at);
  addClassification(tx, id, row.orgType, row.staffedBedCount ?? null, ctx);

  recordAudit(
    tx,
    {
      actorId: ctx.actorId,
      actorType: "human",
      action: "account.create",
      entityType: "account",
      entityId: id,
      outcome: "success",
      after: { org_type: row.orgType, source: "import" },
      correlationId: ctx.correlationId,
    },
    ctx.now,
  );
  writeOutbox(
    tx,
    {
      type: "account.created",
      actor: { id: ctx.actorId, type: "human" },
      correlation_id: ctx.correlationId,
      causation_id: null,
      idempotency_key: null,
      payload: toAccountCreatedPayload({ account_id: id, org_type: row.orgType, source: "import" }),
      provenance: { source: "csv_import" },
    },
    ctx.now,
  );

  // Duplicate detection against every other live account; candidates go to human review (FR-004/005).
  const self = toMatchAccount(tx, getAccount(tx, id)!);
  const candidates = detectCandidates(self, loadMatchAccounts(tx));
  let flagged: string | null = null;
  let reasons: string[] = [];
  for (const candidate of candidates) {
    const created = proposeMerge(
      tx,
      {
        accountId: id,
        otherId: candidate.matchedId,
        reasons: candidate.reasons,
        score: candidate.score,
      },
      ctx.now,
    );
    if (created && flagged === null) {
      flagged = candidate.matchedId;
      reasons = candidate.reasons;
    }
  }
  if (flagged !== null) {
    return {
      rowNumber,
      outcome: "flagged",
      reasonCodes: ["merge_candidate", ...reasons],
      entityId: id,
      matchedId: flagged,
    };
  }
  return { rowNumber, outcome: "created", reasonCodes: [], entityId: id };
}
