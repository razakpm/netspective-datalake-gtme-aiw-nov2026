import { DatabaseSync } from "node:sqlite";

// Interim persistence (ADR-015): node:sqlite behind a small transaction helper. Business code takes a
// `Tx` and never opens its own connection, so the Postgres adapter can replace this later.

export type Tx = DatabaseSync;

export class SqliteDatabase {
  readonly raw: DatabaseSync;

  constructor(path = ":memory:") {
    this.raw = new DatabaseSync(path);
    this.raw.exec(
      "PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;",
    );
  }

  /** Run `fn` atomically. Any throw rolls everything back and rethrows. */
  transaction<T>(fn: (tx: Tx) => T): T {
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = fn(this.raw);
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    this.raw.close();
  }
}
