import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import { SignalService, type SignalActor } from "../src/modules/signals/index.js";

// Provider and AI ingest (task T025, Principle XV): a fake provider goes through the same rules.
let db: SqliteDatabase;
let signals: SignalService;
const provider: SignalActor = { userId: null, actorType: "system", correlationId: "c1" };
const ai: SignalActor = { userId: null, actorType: "ai", correlationId: "c2" };
const base = {
  accountId: "a1",
  typeKey: "implementation_guide_change",
  observation: "The exchange published an updated implementation guide.",
  observedAt: "2026-11-10T00:00:00.000Z",
  source: { sourceId: "default-source-provider", ref: "https://example.org/ig" },
  extractionMethod: "provider",
  extractionConfidence: "medium",
};
const message = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const now = "2026-11-17T00:00:00.000Z";
  db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Acme','acme',?,?)",
    )
    .run(now, now);
  signals = new SignalService(db, {
    excerptMaxChars: 300,
    similarityThreshold: 0.85,
    retentionMonths: 36,
  });
});

describe("ingestSubmission", () => {
  it("records a provider submission as unreviewed and labelled with its method", () => {
    const r = signals.ingestSubmission(provider, base);
    expect(r.signal.reviewStatus).toBe("pending");
    expect(r.signal.extractionMethod).toBe("provider");
    expect(r.signal.isCurrent).toBe(false);
  });
  it("records an AI submission with model and prompt version, and refuses without them", () => {
    const ok = signals.ingestSubmission(ai, {
      ...base,
      extractionMethod: "ai_extracted",
      aiModel: "m",
      aiPromptVersion: "p1",
    });
    expect(ok.signal.aiModel).toBe("m");
    expect(
      message(() => signals.ingestSubmission(ai, { ...base, extractionMethod: "ai_extracted" })),
    ).toContain("invalid_submission");
  });
  it("cannot confirm a buyer statement or raise reliability, and applies the same rules as a manual entry", () => {
    expect(
      message(() =>
        signals.ingestSubmission(provider, { ...base, evidenceStatus: "buyer_confirmed" }),
      ),
    ).toContain("invalid_submission");
    expect(
      message(() => signals.ingestSubmission(provider, { ...base, reliability: "high" })),
    ).toContain("invalid_submission");
    expect(
      message(() => signals.ingestSubmission(provider, { ...base, source: { ref: "x" } })),
    ).toContain("source_required");
    expect(
      message(() => signals.ingestSubmission(provider, { ...base, excerpt: "SSN 000-12-3456" })),
    ).toContain("PHI");
    signals.ingestSubmission(provider, base);
    expect(
      signals.ingestSubmission(provider, {
        ...base,
        observation: "The exchange published an updated implementation guide.",
      }).outcome,
    ).toBe("already_exists");
  });
  it("refuses a human caller and a direct SQL attempt at buyer_confirmed by a provider", () => {
    expect(
      message(() =>
        signals.ingestSubmission({ userId: "u", actorType: "human", correlationId: null }, base),
      ),
    ).toContain("ingest_is_for_providers_and_ai");
    expect(() =>
      db.raw
        .prepare(
          `INSERT INTO signal (id, account_id, type_key, taxonomy_version, source_id, source_ref, source_ref_normalised, observation,
             observed_at, collected_at, reliability, extraction_method, extraction_confidence, evidence_status, freshness_days,
             fresh_until, retention_policy, retain_until, sensitivity, content_fingerprint, created_by_type, created_at, updated_at)
           VALUES ('x','a1','program_announcement',1,'default-source-provider','r','r','o','t','t','high','provider','high','buyer_confirmed',10,'t','b','t','public','f','system','t','t')`,
        )
        .run(),
    ).toThrow();
  });

  it("creates an inline source with the kind given (feature 004 passes the approved rule's kind)", () => {
    const r = signals.ingestSubmission(provider, {
      ...base,
      source: {
        name: "Research: docs.example",
        kind: "official_publication",
        ref: "https://docs.example/p",
      },
    });
    expect(r.signal.source.name).toBe("Research: docs.example");
    expect(r.signal.reliability).toBe("high");
    const src = db.raw
      .prepare("SELECT kind, storage_rule FROM signal_source WHERE name = 'Research: docs.example'")
      .get() as { kind: string; storage_rule: string };
    expect(src).toEqual({ kind: "official_publication", storage_rule: "citation_only" });
    const other = signals.ingestSubmission(provider, {
      ...base,
      observation: "A different observation altogether.",
      source: { name: "Research: plain.example", ref: "https://plain.example/p" },
    });
    expect(other.signal.reliability).toBe("low");
  });
});
