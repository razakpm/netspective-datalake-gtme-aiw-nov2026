import { describe, expect, it } from "vitest";
import { blankSnapshot, REQUIRED_OFFER_FIELDS, type OfferSnapshot } from "@gtm/domain";
import { migrate, seedReference, SqliteDatabase } from "../src/index.js";

// Feature 005 seed (task T010): only facts the repository records; everything else is null ("to be
// provided"). The restricted phrase list is seeded with the default rules in Phase 3 (task T021).
function seeded() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  return db;
}
const one = <T>(db: SqliteDatabase, sql: string, ...args: (string | number)[]) =>
  db.raw.prepare(sql).get(...args) as T;
const all = <T>(db: SqliteDatabase, sql: string, ...args: (string | number)[]) =>
  db.raw.prepare(sql).all(...args) as T[];
const snapshotOf = (db: SqliteDatabase, offerId: string) =>
  JSON.parse(
    one<{ snapshot_json: string }>(
      db,
      "SELECT snapshot_json FROM offer_version WHERE offer_id = ? AND version_no = 1",
      offerId,
    ).snapshot_json,
  ) as OfferSnapshot;
const latestStatus = (db: SqliteDatabase, offerId: string) =>
  one<{ status: string; changed_by: string; note: string | null }>(
    db,
    "SELECT status, changed_by, note FROM offer_version_status WHERE offer_id = ? AND version_no = 1 ORDER BY changed_at DESC, rowid DESC LIMIT 1",
    offerId,
  );

describe("offers", () => {
  it("seeds ten offer heads with a version 1 snapshot each", () => {
    const db = seeded();
    const heads = all<{ id: string; number: number; latest_version_no: number }>(
      db,
      "SELECT id, number, latest_version_no FROM engagement_offer ORDER BY number",
    );
    expect(heads.map((h) => h.id)).toEqual(Array.from({ length: 10 }, (_, i) => `offer-${i + 1}`));
    for (const h of heads) {
      expect(h.latest_version_no).toBe(1);
      expect(snapshotOf(db, h.id).effortEstimate.status).toBe("hypothesis");
    }
  });

  it("approves Offers 1, 5 and 6 once, by the actor seed, with a note; the other offers stay draft", () => {
    const db = seeded();
    for (const n of [1, 5, 6]) {
      const status = latestStatus(db, `offer-${n}`);
      expect(status.status).toBe("approved");
      expect(status.changed_by).toBe("seed");
      expect(status.note).toMatch(/baseline/i);
      expect(
        one<{ in_force_version_no: number }>(
          db,
          "SELECT in_force_version_no FROM engagement_offer WHERE id = ?",
          `offer-${n}`,
        ).in_force_version_no,
      ).toBe(1);
    }
    for (const n of [2, 3, 4, 7, 8, 9, 10]) {
      const status = latestStatus(db, `offer-${n}`);
      expect(status.status).toBe("draft");
      expect(
        one<{ in_force_version_no: number | null }>(
          db,
          "SELECT in_force_version_no FROM engagement_offer WHERE id = ?",
          `offer-${n}`,
        ).in_force_version_no,
      ).toBeNull();
    }
  });

  it("records only the repository facts for Offers 1, 5 and 6 and leaves everything else null", () => {
    const db = seeded();
    const o1 = snapshotOf(db, "offer-1");
    expect(o1).toMatchObject({
      name: "Sender Onboarding Friction Map",
      format: "45-minute session, no PHI",
      paidTypeKey: "sender_readiness_sprint",
    });
    const o6 = snapshotOf(db, "offer-6");
    expect(o6).toMatchObject({
      name: "Pilot Input Trace Workshop",
      format: "90-minute session, 10 fields, no data leaves",
      paidTypeKey: "input_audit",
    });
    const o5 = snapshotOf(db, "offer-5");
    expect(o5).toMatchObject({
      name: "CCDA-to-FHIR Mapping Decision Register",
      format: "gated download",
      paidTypeKey: null,
    });
    expect(o5.conversionPath).toMatch(/ICP1.*Offer 1.*ICP2.*Offer 6/);
    for (const n of [1, 5, 6]) {
      const s = snapshotOf(db, `offer-${n}`);
      expect(s.sqlRuleRef).not.toBeNull();
      expect(s.landingPagePromise).toBeNull();
      expect(s.cta).toBeNull();
      expect(s.intakeFields).toBeNull();
      expect(s.buyerOutput).toBeNull();
      expect(s.effortEstimate.text).toBeNull();
    }
    for (const n of [2, 3, 4, 7, 9, 10]) {
      expect(snapshotOf(db, `offer-${n}`)).toEqual(blankSnapshot());
    }
    expect(REQUIRED_OFFER_FIELDS.length).toBeGreaterThan(0);
  });

  it("links Offer 8 to Resilience Review and nothing else", () => {
    const db = seeded();
    expect(snapshotOf(db, "offer-8")).toEqual({
      ...blankSnapshot(),
      paidTypeKey: "resilience_review",
    });
  });

  it("seeds Offer 7's limitation active and unacknowledged", () => {
    const db = seeded();
    const rows = all<{ offer_id: string; key: string; wording: string; active: number }>(
      db,
      "SELECT offer_id, key, wording, active FROM offer_limitation",
    );
    expect(rows).toEqual([
      {
        offer_id: "offer-7",
        key: "evaluation_is_buyer_prompt_only",
        wording: "Evaluation is a buyer prompt only",
        active: 1,
      },
    ]);
    expect(one<{ c: number }>(db, "SELECT count(*) c FROM offer_limitation_ack").c).toBe(0);
  });

  it("seeds capacity limits as hypotheses: Offer 6 three per month, Offer 1 three per week", () => {
    const db = seeded();
    const rows = all<{
      offer_id: string;
      period_kind: string;
      limit_sessions: number;
      set_by: string;
    }>(
      db,
      "SELECT offer_id, period_kind, limit_sessions, set_by FROM offer_capacity ORDER BY offer_id",
    );
    expect(rows).toEqual([
      { offer_id: "offer-1", period_kind: "week", limit_sessions: 3, set_by: "seed" },
      { offer_id: "offer-6", period_kind: "month", limit_sessions: 3, set_by: "seed" },
    ]);
  });

  it("seeds no scoring criteria and no scores", () => {
    const db = seeded();
    expect(one<{ c: number }>(db, "SELECT count(*) c FROM offer_score_criterion").c).toBe(0);
    expect(one<{ c: number }>(db, "SELECT count(*) c FROM offer_score").c).toBe(0);
  });
});

describe("paid engagement types", () => {
  it("seeds the three types with the scope in the repository and Resilience Review inactive", () => {
    const db = seeded();
    const types = all<{
      key: string;
      weeks_min: number | null;
      weeks_max: number | null;
      scope_json: string;
      scope_confirmed: number;
      status: string;
    }>(db, "SELECT * FROM paid_engagement_type ORDER BY key");
    expect(types.map((t) => t.key)).toEqual([
      "input_audit",
      "resilience_review",
      "sender_readiness_sprint",
    ]);
    const byKey = Object.fromEntries(types.map((t) => [t.key, t]));
    expect(byKey["sender_readiness_sprint"]).toMatchObject({
      weeks_min: 6,
      weeks_max: 6,
      status: "active",
    });
    expect(JSON.parse(byKey["sender_readiness_sprint"]!.scope_json)).toEqual([
      "3 to 5 senders",
      "one format",
    ]);
    expect(byKey["input_audit"]).toMatchObject({ weeks_min: 6, weeks_max: 8, status: "active" });
    expect(JSON.parse(byKey["input_audit"]!.scope_json)).toEqual([
      "one use case",
      "1 to 2 sources",
    ]);
    expect(byKey["resilience_review"]).toMatchObject({
      weeks_min: null,
      weeks_max: null,
      scope_confirmed: 0,
      status: "inactive",
    });
    expect(JSON.parse(byKey["resilience_review"]!.scope_json)).toEqual([]);
  });

  it("seeds only in-source deliverables, all approved", () => {
    const db = seeded();
    const rows = all<{ type_key: string; text: string; in_source: number; approval: string }>(
      db,
      "SELECT type_key, text, in_source, approval FROM paid_engagement_deliverable ORDER BY type_key, text",
    );
    expect(rows.every((r) => r.in_source === 1 && r.approval === "approved")).toBe(true);
    expect(rows.map((r) => `${r.type_key}: ${r.text}`)).toEqual([
      "input_audit: go/no-go memo",
      "input_audit: lineage-tracked feed",
      "sender_readiness_sprint: header contract",
      "sender_readiness_sprint: per-sender rejection reporting",
      "sender_readiness_sprint: raw-first landing",
    ]);
  });
});

describe("capabilities", () => {
  it("seeds 19 slots with every attribute null and none approved", () => {
    const db = seeded();
    const rows = all<Record<string, string | number | null>>(
      db,
      "SELECT * FROM service_capability ORDER BY slot",
    );
    expect(rows.map((r) => r["id"])).toEqual(
      Array.from({ length: 19 }, (_, i) => `capability-${String(i + 1).padStart(2, "0")}`),
    );
    for (const r of rows) {
      for (const col of [
        "name",
        "description",
        "input_types_json",
        "output_types_json",
        "buyer_problems_json",
        "limitations_json",
        "required_expertise",
        "potential_paid_type_key",
        "public_claim_id",
      ]) {
        expect(r[col], `${r["id"]}.${col}`).toBeNull();
      }
      expect(r["public_claim_status"]).toBe("not_approved");
    }
    expect(one<{ c: number }>(db, "SELECT count(*) c FROM capability_delivery_example").c).toBe(0);
  });
});

describe("idempotence", () => {
  it("running the seed twice changes nothing", () => {
    const db = seeded();
    const tables = [
      "engagement_offer",
      "offer_version",
      "offer_version_status",
      "offer_limitation",
      "offer_capacity",
      "paid_engagement_type",
      "paid_engagement_deliverable",
      "service_capability",
    ];
    const snapshot = () =>
      JSON.stringify(tables.map((t) => db.raw.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all()));
    const first = snapshot();
    db.transaction((tx) => seedReference(tx));
    expect(snapshot()).toBe(first);
  });
});
