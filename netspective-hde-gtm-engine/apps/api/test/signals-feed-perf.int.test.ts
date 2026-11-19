import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import { listSignals, SignalService, type FeedFilters } from "../src/modules/signals/index.js";

// SC-010 (task T044): any filter combination returns in under 2 seconds with 10,000 signals; and the
// 002 evidence reference and ICP assessment tables can be linked without changing any 002 rule (T065).
describe("signal feed performance and 002 compatibility", () => {
  it("answers every filter combination over 10,000 signals in under 2 seconds", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.transaction((tx) => seedReference(tx));
    const now = "2026-11-17T00:00:00.000Z";
    const types = [
      "org_profile_fact",
      "implementation_guide_change",
      "data_quality_issue",
      "procurement_notice",
    ];
    db.transaction((tx) => {
      const acc = tx.prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
      );
      for (let a = 0; a < 200; a++) acc.run(`acc-${a}`, `Org ${a}`, `org ${a}`, now, now);
      const sig = tx.prepare(
        `INSERT INTO signal (id, account_id, type_key, taxonomy_version, source_id, source_ref, source_ref_normalised,
           observation, observed_at, collected_at, reliability, extraction_method, extraction_confidence,
           evidence_status, review_status, freshness_days, fresh_until, retention_policy, retain_until,
           sensitivity, content_fingerprint, created_by_type, created_at, updated_at)
         VALUES (?,?,?,1,'default-source-official_publication','ref','ref',?,?,?, 'high','manual',?,'observed',?,180,?,'business_record','2030-01-01T00:00:00.000Z','public',?,'human',?,?)`,
      );
      const tag = tx.prepare("INSERT INTO signal_tag (signal_id, dimension, value) VALUES (?,?,?)");
      for (let i = 0; i < 10_000; i++) {
        const id = `sig-${String(i).padStart(6, "0")}`;
        sig.run(
          id,
          `acc-${i % 200}`,
          types[i % 4]!,
          `Observation number ${i}`,
          now,
          now,
          ["low", "medium", "high"][i % 3]!,
          ["pending", "approved", "rejected"][i % 3]!,
          i % 2 ? "2027-01-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
          `fp-${i}`,
          now,
          now,
        );
        if (i % 2 === 0) tag.run(id, "icp", i % 4 === 0 ? "icp1" : "icp2");
        if (i % 5 === 0) tag.run(id, "capability", "fhir_mapping");
        if (i % 7 === 0) tag.run(id, "offer", "audit");
      }
    });
    const combos: FeedFilters[] = [
      {},
      { type: "procurement_notice" },
      { category: "B" },
      { icp: "icp1" },
      { accountId: "acc-5" },
      { sourceId: "default-source-official_publication" },
      { capability: "fhir_mapping", offer: "audit" },
      { confidence: "high" },
      { freshness: "stale" },
      { freshness: "fresh", reviewStatus: "approved" },
      {
        type: "data_quality_issue",
        icp: "icp2",
        confidence: "low",
        freshness: "fresh",
        reviewStatus: "pending",
        capability: "fhir_mapping",
      },
      { currentOnly: true, limit: 200 },
    ];
    for (const f of combos) {
      const start = performance.now();
      db.transaction((tx) => listSignals(tx, f, new Date(now)));
      expect(performance.now() - start, JSON.stringify(f)).toBeLessThan(2000);
    }
  });

  it("links a signal to a 002 evidence reference and an ICP assessment without touching either", () => {
    const db = new SqliteDatabase();
    migrate(db);
    db.transaction((tx) => seedReference(tx));
    const now = "2026-11-17T00:00:00.000Z";
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
      )
      .run(now, now);
    db.raw
      .prepare(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES ('ev1','a1','sender_onboarding_friction','w','r',?,?,'observed')",
      )
      .run(now, now);
    const before = JSON.stringify(db.raw.prepare("SELECT * FROM evidence_reference").all());
    const signals = new SignalService(db, {
      excerptMaxChars: 300,
      similarityThreshold: 0.85,
      retentionMonths: 36,
    });
    const r = signals.record(
      { userId: "u", actorType: "human", correlationId: null },
      {
        accountId: "a1",
        typeKey: "program_announcement",
        source: { sourceId: "default-source-official_publication", ref: "https://example.org/p" },
        observation: "A program was announced.",
        observedAt: now,
        supports: [{ entityType: "evidence_reference", entityId: "ev1" }],
      },
    );
    expect(r.signal.supporting).toEqual([{ entityType: "evidence_reference", entityId: "ev1" }]);
    expect(JSON.stringify(db.raw.prepare("SELECT * FROM evidence_reference").all())).toBe(before);
    expect(
      (db.raw.prepare("SELECT count(*) c FROM icp_fit_assessment").get() as { c: number }).c,
    ).toBe(0);
  });
});
