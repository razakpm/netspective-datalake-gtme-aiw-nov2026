import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteDatabase } from "./database.js";

// Forward-only migrations with a checksum guard (spec FR-047): applied files may never change or
// disappear, and down migrations are refused.

export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export const SQLITE_MIGRATIONS_DIR = join(import.meta.dirname, "..", "..", "migrations-sqlite");

export function migrate(db: SqliteDatabase, dir = SQLITE_MIGRATIONS_DIR): string[] {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const down = files.find((f) => /\.down\.sql$/.test(f) || /^down/.test(f));
  if (down) throw new MigrationError(`down migrations are not allowed: ${down}`);

  // One write transaction for the whole run: two processes starting together cannot both apply the same
  // migration (the second waits, then finds them applied).
  return db.transaction((tx) => {
    tx.exec(
      "CREATE TABLE IF NOT EXISTS schema_migration (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)",
    );
    const applied = new Map(
      (
        tx.prepare("SELECT name, checksum FROM schema_migration").all() as {
          name: string;
          checksum: string;
        }[]
      ).map((r) => [r.name, r.checksum]),
    );

    const contents = new Map(files.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
    for (const [name, checksum] of applied) {
      const text = contents.get(name);
      if (text === undefined) throw new MigrationError(`applied migration is missing: ${name}`);
      if (sha256(text) !== checksum)
        throw new MigrationError(`applied migration was modified: ${name}`);
    }

    const ran: string[] = [];
    for (const [name, text] of contents) {
      if (applied.has(name)) continue;
      tx.exec(text);
      tx.prepare("INSERT INTO schema_migration (name, checksum, applied_at) VALUES (?, ?, ?)").run(
        name,
        sha256(text),
        new Date().toISOString(),
      );
      ran.push(name);
    }
    return ran;
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
