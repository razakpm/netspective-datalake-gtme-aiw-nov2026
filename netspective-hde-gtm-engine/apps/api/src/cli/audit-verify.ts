import { SqliteDatabase } from "@gtm/db";
import { verifyAuditChain } from "../modules/audit/index.js";

// `pnpm audit:verify --db <sqlite file>`: walks the audit chain; exit 1 and the offending row id on failure.
const args = process.argv;
const dbPath = args[args.indexOf("--db") + 1] ?? process.env["GTM_SQLITE_PATH"];
if (!dbPath || (args.indexOf("--db") === -1 && !process.env["GTM_SQLITE_PATH"])) {
  console.error("usage: audit-verify --db <sqlite file> (or GTM_SQLITE_PATH)");
  process.exit(2);
}
const db = new SqliteDatabase(dbPath);
try {
  const result = verifyAuditChain(db);
  if (result.ok) {
    console.log(`audit chain verified: ${result.count} events`);
  } else {
    console.error(`audit chain BROKEN at event ${result.rowId} (${result.reason})`);
    process.exitCode = 1;
  }
} finally {
  db.close();
}
