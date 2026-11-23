import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import { IcpService } from "../src/modules/icp/index.js";

// Task T023 (feature 002 slice built in feature 006): ICP fit on the synthetic organisations.
const now = () => new Date("2026-11-23T10:00:00.000Z");
const ctx = { actorId: "system", actorType: "system" as const, correlationId: "c", now };

function setup() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const account = (id: string, orgType: string, beds: number | null = null) => {
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,'t','t')",
      )
      .run(id, id, id);
    db.raw
      .prepare(
        "INSERT INTO account_classification (id, account_id, org_type, staffed_bed_count, recorded_at) VALUES (?,?,?,?,'t')",
      )
      .run(`cl-${id}`, id, orgType, beds);
  };
  const evidence = (account: string, topic: string, status: string) =>
    db.raw
      .prepare(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?,?,?,?,'t','t',?)",
      )
      .run(`${account}-${topic}-${status}`, account, topic, "synthetic", "ref", status);
  return { db, icp: new IcpService(db), account, evidence };
}

describe("IcpService", () => {
  it("assesses the fixture organisations as the spec fixes them", () => {
    const { db, icp, account, evidence } = setup();
    account("helix", "biotech");
    account("north", "health_information_exchange");
    evidence("north", "sender_onboarding_friction", "observed");
    account("river", "health_system");
    evidence("river", "mid_size_judgement", "derived_interpretation");
    evidence("river", "stalled_ai_pilot", "buyer_confirmed");
    account("summit", "health_system");
    evidence("summit", "mid_size_judgement", "derived_interpretation");
    evidence("summit", "generic_ai_interest", "observed");
    const fit = (id: string) => db.transaction((tx) => icp.assess(tx, id, ctx));
    expect(fit("helix")).toMatchObject({ fit: "excluded" });
    expect(fit("north")).toMatchObject({ icp: "icp1", fit: "strong" });
    expect(fit("river")).toMatchObject({ icp: "icp2", fit: "possible" });
    const summit = fit("summit");
    expect(summit).toMatchObject({ icp: "icp2", fit: "possible" });
    const unmet = JSON.parse(
      (
        db.raw
          .prepare("SELECT unmet FROM icp_fit_assessment WHERE account_id='summit' AND icp='icp2'")
          .get() as { unmet: string }
      ).unmet,
    );
    expect(unmet).toContain("demonstrated_data_problem");
  });
  it("stores one append-only assessment per ICP per run, with the definition version and an audit record", () => {
    const { db, icp, account, evidence } = setup();
    account("north", "health_information_exchange");
    evidence("north", "ig_change_friction", "observed");
    db.transaction((tx) => icp.assess(tx, "north", ctx));
    db.transaction((tx) => icp.assess(tx, "north", ctx));
    expect(
      (db.raw.prepare("SELECT count(*) c FROM icp_fit_assessment").get() as { c: number }).c,
    ).toBe(4);
    expect(
      db.raw.prepare("SELECT definition_version v FROM icp_fit_assessment LIMIT 1").get(),
    ).toEqual({ v: 1 });
    expect(
      (
        db.raw.prepare("SELECT count(*) c FROM audit_event WHERE action='icp.assess'").get() as {
          c: number;
        }
      ).c,
    ).toBe(4);
    expect(() => db.raw.prepare("UPDATE icp_fit_assessment SET status='weak'").run()).toThrow(
      /append-only/,
    );
  });
  it("is deterministic: the same inputs give the same inputs hash and status", () => {
    const { db, icp, account, evidence } = setup();
    account("north", "health_information_exchange");
    evidence("north", "ig_change_friction", "observed");
    db.transaction((tx) => icp.assess(tx, "north", ctx));
    db.transaction((tx) => icp.assess(tx, "north", ctx));
    const hashes = db.raw
      .prepare("SELECT DISTINCT inputs_hash h FROM icp_fit_assessment WHERE icp='icp1'")
      .all();
    expect(hashes).toHaveLength(1);
  });
  it("reads the current fit from the latest assessments, and is unknown with none", () => {
    const { db, icp, account } = setup();
    account("new", "health_information_exchange");
    expect(icp.currentFit("new")).toMatchObject({ icp: null, fit: "unknown" });
    db.transaction((tx) => icp.assess(tx, "new", ctx));
    expect(icp.currentFit("new").fit).toBe("unknown");
  });
});
