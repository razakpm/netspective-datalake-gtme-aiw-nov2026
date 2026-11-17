import { findClassificationProblems } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { COLUMN_CLASSIFICATION, migrate, SqliteDatabase } from "../src/index.js";

// FR-015 (task T072): every column declares a classification and none is `prohibited`. The test reads
// the real schema, so a new column without an entry fails the build.
function actualColumns(): Record<string, string[]> {
  const db = new SqliteDatabase();
  migrate(db);
  const tables = db.raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[];
  return Object.fromEntries(
    tables.map((t) => [
      t.name,
      (db.raw.prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[]).map(
        (c) => c.name,
      ),
    ]),
  );
}

describe("data classification declarations", () => {
  it("covers every column of every table, with nothing prohibited and nothing stale", () => {
    expect(findClassificationProblems(actualColumns(), COLUMN_CLASSIFICATION)).toEqual([]);
  });

  it("fails when a column is added without a classification", () => {
    const actual = actualColumns();
    actual["audit_event"] = [...actual["audit_event"]!, "free_text_note"];
    expect(findClassificationProblems(actual, COLUMN_CLASSIFICATION)).toEqual([
      { table: "audit_event", field: "free_text_note", problem: "unclassified" },
    ]);
  });

  it("fails when a new table has no declaration", () => {
    expect(
      findClassificationProblems({ ...actualColumns(), brand_new: ["id"] }, COLUMN_CLASSIFICATION),
    ).toContainEqual({
      table: "brand_new",
      problem: "unclassified",
    });
  });

  it("fails on a prohibited or invalid classification and on stale entries", () => {
    const registry = {
      t: { a: "prohibited", b: "made_up" },
      gone: { x: "public" },
    } as never;
    expect(findClassificationProblems({ t: ["a", "b", "c"] }, registry)).toEqual([
      { table: "t", field: "a", problem: "prohibited" },
      { table: "t", field: "b", problem: "invalid" },
      { table: "t", field: "c", problem: "unclassified" },
      { table: "gone", problem: "stale" },
    ]);
  });
});
