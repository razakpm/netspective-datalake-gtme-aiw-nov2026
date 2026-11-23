import { describe, expect, it } from "vitest";
import { parseRuleSet, RULE_SET_V1 } from "@gtm/domain";
import { migrate, seedReference, SqliteDatabase } from "../src/index.js";

// Feature 006 seed (task T014): routing rule set version 1, labelled a hypothesis. No notice version.
function seeded() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  return db;
}
const one = <T>(db: SqliteDatabase, sql: string) => db.raw.prepare(sql).get() as T;

describe("feature 006 seed", () => {
  it("creates rule set version 1, active, by the seed actor, with the seven v1 rules", () => {
    const db = seeded();
    const row = one<{
      version: number;
      state: string;
      author: string;
      activated_by: string;
      reason: string;
      rules_json: string;
    }>(db, "SELECT * FROM routing_rule_set");
    expect(row.version).toBe(1);
    expect(row.state).toBe("active");
    expect(row.author).toBe("seed");
    expect(row.activated_by).toBe("seed");
    expect(row.reason.toLowerCase()).toContain("hypothesis");
    const parsed = parseRuleSet(JSON.parse(row.rules_json));
    expect(parsed.ok).toBe(true);
    expect(JSON.parse(row.rules_json)).toEqual(RULE_SET_V1);
    expect(RULE_SET_V1.rules.map((r) => r.id)).toEqual([
      "icp1-onboarding-friction",
      "icp2-pilot-input",
      "offer5-download-icp1",
      "offer5-download-icp2",
      "multi-format-gap",
      "ccda-fhir-decisions",
      "no-supported-hypothesis",
    ]);
  });

  it("creates the two default ICP definitions, version 1, active hypotheses", () => {
    const db = seeded();
    const rows = db.raw
      .prepare("SELECT icp, version, state, status_label FROM icp_definition ORDER BY icp")
      .all();
    expect(rows).toEqual([
      { icp: "icp1", version: 1, state: "active", status_label: "hypothesis" },
      { icp: "icp2", version: 1, state: "active", status_label: "hypothesis" },
    ]);
  });

  it("does not invent a notice version (the wording comes from the business)", () => {
    const db = seeded();
    expect(one<{ c: number }>(db, "SELECT count(*) c FROM notice_version").c).toBe(0);
  });

  it("is idempotent", () => {
    const db = seeded();
    const snapshot = () =>
      JSON.stringify([
        db.raw.prepare("SELECT * FROM routing_rule_set").all(),
        db.raw.prepare("SELECT * FROM icp_definition").all(),
      ]);
    const first = snapshot();
    db.transaction((tx) => seedReference(tx));
    expect(snapshot()).toBe(first);
  });
});
