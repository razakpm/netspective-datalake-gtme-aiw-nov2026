import { SqliteDatabase } from "@gtm/db";
import {
  DEFAULT_MINIMUM_RETENTION_MONTHS,
  dropExpiredAuditPeriods,
  RetentionRefusedError,
} from "../modules/audit/index.js";

// `pnpm audit:retention --older-than 7y|84m --db <file>`: privileged, audited removal of whole expired
// periods. Refuses periods shorter than AUDIT_RETENTION_MIN_MONTHS (default 84).

function parsePeriod(text: string | undefined): number {
  const match = /^(\d+)([my])$/.exec(text ?? "");
  if (!match) throw new RetentionRefusedError("--older-than must look like 84m or 7y");
  return Number(match[1]) * (match[2] === "y" ? 12 : 1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dbPath = arg("--db") ?? process.env["GTM_SQLITE_PATH"];
if (!dbPath) {
  console.error("usage: audit-retention --older-than <84m|7y> --db <sqlite file>");
  process.exit(2);
}
const db = new SqliteDatabase(dbPath);
try {
  const dropped = dropExpiredAuditPeriods(db, {
    retentionMonths: parsePeriod(arg("--older-than")),
    minimumMonths: Number(
      process.env["AUDIT_RETENTION_MIN_MONTHS"] ?? DEFAULT_MINIMUM_RETENTION_MONTHS,
    ),
  });
  console.log(
    dropped.length === 0
      ? "nothing to drop"
      : dropped.map((d) => `dropped ${d.period} (${d.rowCount} events)`).join("\n"),
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "retention failed");
  process.exitCode = 1;
} finally {
  db.close();
}
