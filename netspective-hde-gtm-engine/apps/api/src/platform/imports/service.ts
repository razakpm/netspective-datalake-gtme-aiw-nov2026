import { createHash } from "node:crypto";
import type { SqliteDatabase, Tx } from "@gtm/db";
import { parseCsv, type CsvRow, type CsvSpec } from "@gtm/domain";
import { v7 as uuidv7 } from "uuid";
import { HttpError } from "../../http/errors.js";
import { recordAudit } from "../../modules/audit/index.js";

// Shared CSV import runner (task T017, research R-03). The whole file is validated first (headers, size,
// rows), then every row is applied in its own SAVEPOINT so a rejected row leaves nothing behind while
// valid rows are kept (FR-003). Reports hold outcomes and reason codes only, never row content; the raw
// file is never stored (only its hash). First version: the import runs inside the request (<= the row
// limit); a queued job is a later change (open question #34).

export type RowOutcomeKind =
  "created" | "updated" | "unchanged" | "rejected" | "flagged" | "conflict";

export interface RowOutcome {
  rowNumber: number;
  outcome: RowOutcomeKind;
  reasonCodes: string[];
  entityId?: string | null;
  matchedId?: string | null;
}

export interface ImportContext {
  actorId: string;
  correlationId: string | null;
  now: () => Date;
}

export type RowProcessor = (tx: Tx, row: CsvRow, ctx: ImportContext) => RowOutcome;

export interface ImportRunView {
  id: string;
  kind: "accounts" | "contacts";
  state: "completed";
  dryRun: boolean;
  rowCount: number;
  counts: Record<string, number>;
  rows: {
    rowNumber: number;
    outcome: RowOutcomeKind;
    reasonCodes: string[];
    entityId: string | null;
    matchedId: string | null;
  }[];
}

export interface ImportLimits {
  maxBytes: number;
  maxRows: number;
}

class DryRunAbort extends Error {
  constructor(readonly view: ImportRunView) {
    super("dry run");
  }
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function parseOrReject(text: string, spec: CsvSpec, limits: ImportLimits): CsvRow[] {
  const parsed = parseCsv(text, spec, limits);
  if (parsed.ok) return parsed.rows;
  const detail = parsed.headers ? `${parsed.code}: ${parsed.headers.join(", ")}` : parsed.code;
  throw new HttpError(422, "File rejected", `The file cannot be imported (${detail})`, {
    type: "urn:gtm:problem:import-rejected",
  });
}

export function countOutcomes(rows: readonly RowOutcome[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
  return counts;
}

interface ApplyInput {
  kind: "accounts" | "contacts";
  text: string;
  rows: readonly CsvRow[];
  process: RowProcessor;
  ctx: ImportContext;
}

/** Apply every row in its own savepoint inside the caller's transaction, then record the run. */
export function applyImportInTx(tx: Tx, input: ApplyInput, dryRun = false): ImportRunView {
  const { ctx } = input;
  const outcomes: RowOutcome[] = [];
  let n = 0;
  for (const row of input.rows) {
    if (row.error) {
      outcomes.push({ rowNumber: row.rowNumber, outcome: "rejected", reasonCodes: [row.error] });
      continue;
    }
    const savepoint = `row_${n++}`;
    tx.exec(`SAVEPOINT ${savepoint}`);
    try {
      outcomes.push(input.process(tx, row, ctx));
      tx.exec(`RELEASE ${savepoint}`);
    } catch (error) {
      tx.exec(`ROLLBACK TO ${savepoint}`);
      tx.exec(`RELEASE ${savepoint}`);
      if (error instanceof HttpError) throw error;
      outcomes.push({ rowNumber: row.rowNumber, outcome: "rejected", reasonCodes: ["row_failed"] });
    }
  }

  const id = dryRun ? "dry-run" : uuidv7();
  const counts = countOutcomes(outcomes);
  const view: ImportRunView = {
    id,
    kind: input.kind,
    state: "completed",
    dryRun,
    rowCount: input.rows.length,
    counts,
    rows: outcomes.map((o) => ({
      rowNumber: o.rowNumber,
      outcome: o.outcome,
      reasonCodes: o.reasonCodes,
      entityId: o.entityId ?? null,
      matchedId: o.matchedId ?? null,
    })),
  };
  if (dryRun) return view;

  const at = ctx.now().toISOString();
  tx.prepare(
    `INSERT INTO import_run (id, kind, file_sha256, row_count, state, counts, submitted_by,
       submitted_at, finished_at) VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(
    id,
    input.kind,
    sha256(input.text),
    input.rows.length,
    "completed",
    JSON.stringify(counts),
    ctx.actorId,
    at,
    at,
  );
  const insertRow = tx.prepare(
    `INSERT INTO import_row (import_run_id, row_number, outcome, reason_codes, entity_id, matched_id)
     VALUES (?,?,?,?,?,?)`,
  );
  for (const r of view.rows) {
    insertRow.run(
      id,
      r.rowNumber,
      r.outcome,
      JSON.stringify(r.reasonCodes),
      r.entityId,
      r.matchedId,
    );
  }
  recordAudit(
    tx,
    {
      actorId: ctx.actorId,
      actorType: "human",
      action: `${input.kind}.import`,
      entityType: "import_run",
      entityId: id,
      outcome: "success",
      after: { rows: input.rows.length, ...counts },
      correlationId: ctx.correlationId,
    },
    ctx.now,
  );
  return view;
}

/** Validate and apply nothing: everything the rows would do is rolled back (the dry-run report). */
export function dryRunImport(db: SqliteDatabase, input: ApplyInput): ImportRunView {
  try {
    return db.transaction((tx) => {
      throw new DryRunAbort(applyImportInTx(tx, input, true));
    });
  } catch (error) {
    if (error instanceof DryRunAbort) return error.view;
    throw error;
  }
}

export function getImportRun(db: SqliteDatabase, id: string): ImportRunView {
  const run = db.raw.prepare("SELECT * FROM import_run WHERE id = ?").get(id) as
    { id: string; kind: "accounts" | "contacts"; row_count: number; counts: string } | undefined;
  if (!run) throw new HttpError(404, "Not found", "No such import run");
  const rows = db.raw
    .prepare("SELECT * FROM import_row WHERE import_run_id = ? ORDER BY row_number")
    .all(id) as {
    row_number: number;
    outcome: RowOutcomeKind;
    reason_codes: string;
    entity_id: string | null;
    matched_id: string | null;
  }[];
  return {
    id: run.id,
    kind: run.kind,
    state: "completed",
    dryRun: false,
    rowCount: run.row_count,
    counts: JSON.parse(run.counts) as Record<string, number>,
    rows: rows.map((r) => ({
      rowNumber: r.row_number,
      outcome: r.outcome,
      reasonCodes: JSON.parse(r.reason_codes) as string[],
      entityId: r.entity_id,
      matchedId: r.matched_id,
    })),
  };
}
