import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ReviewService,
  SignalService,
  SourceService,
  currentEvidence,
  listSignals,
  type RecordInput,
  type SignalActor,
} from "../src/modules/signals/index.js";

// Feature 003 service behaviour for all user stories, before any route exists (tasks T019, T029, T033,
// T039, T045, T047, T049). Synthetic data only.
const DAY = 86_400_000;
let db: SqliteDatabase;
let clock: { now: Date };
let signals: SignalService;
let reviews: ReviewService;
let sources: SourceService;

const SETTINGS = { excerptMaxChars: 300, similarityThreshold: 0.85, retentionMonths: 36 };
const human = (id = "analyst-1"): SignalActor => ({
  userId: id,
  actorType: "human",
  correlationId: "corr-1",
  now: () => clock.now,
});
const reviewer = () => human("reviewer-1");
const ai: SignalActor = {
  userId: null,
  actorType: "ai",
  correlationId: "corr-ai",
  now: () => clock.now,
};
const OFFICIAL = "default-source-official_publication";
const THIRD_PARTY = "default-source-third_party";
const BUYER = "default-source-buyer_statement";

const base = (over: Partial<RecordInput> = {}): RecordInput => ({
  accountId: "acc-1",
  typeKey: "implementation_guide_change",
  source: { sourceId: OFFICIAL, ref: "https://example.org/ig/1" },
  observation: "The exchange published an updated implementation guide for claims attachments.",
  observedAt: "2026-11-10T00:00:00.000Z",
  publishedAt: "2026-11-09T00:00:00.000Z",
  ...over,
});
const count = (table: string) =>
  (db.raw.prepare(`SELECT count(*) c FROM ${table}`).get() as { c: number }).c;

beforeEach(() => {
  db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  clock = { now: new Date("2026-11-17T12:00:00.000Z") };
  for (const [id, name, merged] of [
    ["acc-1", "Lakeshore HIE", null],
    ["acc-2", "Lakeshore Health Exchange", "acc-1"],
    ["acc-3", "Other Org", null],
  ] as const) {
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, merged_into, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        id,
        name,
        name.toLowerCase(),
        merged,
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
  }
  db.raw
    .prepare(
      "INSERT INTO contact (id, full_name, created_at, updated_at) VALUES ('con-1','Pat Example','2026-01-01','2026-01-01')",
    )
    .run();
  db.raw
    .prepare(
      "INSERT INTO account_contact_relationship (id, account_id, contact_id, started_at) VALUES ('r1','acc-1','con-1','2026-01-01')",
    )
    .run();
  signals = new SignalService(db, SETTINGS);
  reviews = new ReviewService(db);
  sources = new SourceService(db, SETTINGS.excerptMaxChars);
});

const record = (over: Partial<RecordInput> = {}, actor = human()) =>
  signals.record(actor, base(over));
const codes = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no error";
};

describe("recording (US1, US2)", () => {
  it("records a manual signal as pending, under the taxonomy version, with full provenance", () => {
    const r = record({
      contactId: "con-1",
      relevance: { icp: ["icp1"], capability: ["fhir_mapping"], offer: ["audit"] },
    });
    expect(r.outcome).toBe("created");
    const s = r.signal;
    expect(s.reviewStatus).toBe("pending");
    expect(s.isCurrent).toBe(false);
    expect(s.taxonomyVersion).toBe(1);
    expect(s.category).toBe("B");
    expect(s.extractionMethod).toBe("manual");
    expect(s.supporting).toEqual([]);
    expect(s.contradictory).toEqual([]);
    expect(s.relevance).toEqual({ icp: ["icp1"], capability: ["fhir_mapping"], offer: ["audit"] });
    expect(s.provenance.map((p) => p.kind)).toEqual(["first_recorded"]);
    expect(s.retention.policy).toBe("business_record");
    expect(s.sensitivity).toBe("confidential_commercial");
    expect(s.contactId).toBe("con-1");
    expect(s.definitions.reliability.unknown).toMatch(/never read as low or high/);
  });

  it("refuses a missing source, unknown type, unknown account and an unrelated contact", () => {
    expect(codes(() => record({ source: { ref: "https://example.org/x" } }))).toContain(
      "source_required",
    );
    expect(codes(() => record({ source: { sourceId: OFFICIAL, ref: "  " } }))).toContain(
      "source_reference_required",
    );
    expect(codes(() => record({ typeKey: "nope" }))).toContain("unknown_or_retired_type");
    expect(codes(() => record({ accountId: "missing" }))).toContain("unknown_account");
    expect(codes(() => record({ accountId: "acc-3", contactId: "con-1" }))).toContain(
      "contact_not_related_to_account",
    );
    expect(count("signal")).toBe(0);
    expect(count("audit_event")).toBeGreaterThanOrEqual(5);
  });

  it("stores conclusion-like text as plain observation and accepts first-party category I", () => {
    const r = record({ observation: "This organisation is a strong ICP fit and will buy" });
    expect(r.signal.observation).toContain("strong ICP fit");
    const f = record({
      typeKey: "workshop_meeting_note",
      source: { sourceId: "default-source-first_party", ref: "workshop-2026-11" },
      observation: "Attended the interoperability workshop.",
      publishedAt: undefined,
    });
    expect(f.signal.category).toBe("I");
    expect(f.signal.undated).toBe(false);
  });

  it("refuses PHI-like text whole: nothing stored, audit holds rule ids only, nothing echoed", () => {
    const message = codes(() => record({ excerpt: "Patient SSN 000-12-3456 on file" }));
    expect(message).toContain("PHI");
    expect(message).not.toContain("000-12-3456");
    expect(count("signal")).toBe(0);
    const audit = db.raw
      .prepare(
        "SELECT action, after_summary FROM audit_event WHERE action = 'signal.record.refused'",
      )
      .all() as { after_summary: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit)).not.toContain("000-12-3456");
    expect(JSON.stringify(audit)).toContain("rule_ids");
    for (const field of ["observation", "source"] as const) {
      const input =
        field === "observation"
          ? { observation: "MRN 000-12-3456 noted" }
          : { source: { sourceId: OFFICIAL, ref: "https://example.org/?ssn=000-12-3456" } };
      expect(codes(() => record(input))).toContain("PHI");
    }
    expect(count("signal")).toBe(0);
  });

  it("holds AI and provider submissions to the same rules and starts them pending", () => {
    const r = signals.record(
      ai,
      base({ extractionMethod: "ai_extracted", aiModel: "model-x", aiPromptVersion: "p1" }),
    );
    expect(r.signal.reviewStatus).toBe("pending");
    expect(r.signal.aiModel).toBe("model-x");
    expect(codes(() => signals.record(ai, base({ extractionMethod: "ai_extracted" })))).toContain(
      "ai_model_required",
    );
    expect(
      codes(() =>
        signals.record(
          ai,
          base({
            observation: "Different text for a second signal",
            evidenceStatus: "buyer_confirmed",
            source: { sourceId: BUYER, ref: "x" },
            extractionMethod: "provider",
          }),
        ),
      ),
    ).toContain("buyer_confirmed_not_allowed");
    expect(
      codes(() =>
        signals.record(
          ai,
          base({
            observation: "Another distinct observation here",
            reliability: "high",
            extractionMethod: "provider",
          }),
        ),
      ),
    ).toContain("reliability_override_not_allowed");
    expect(
      codes(() =>
        record({ observation: "Human claims provider method", extractionMethod: "provider" }),
      ),
    ).toContain("provider_method_reserved");
  });

  it("lets only a human, manual entry from a buyer statement be buyer_confirmed", () => {
    const r = record({
      source: { sourceId: BUYER, ref: "email-2026-11-12" },
      evidenceStatus: "buyer_confirmed",
      observation: "The CIO told us the migration is planned.",
    });
    expect(r.signal.evidenceStatus).toBe("buyer_confirmed");
    expect(
      codes(() =>
        record({
          evidenceStatus: "buyer_confirmed",
          observation: "Official source cannot be buyer confirmed",
        }),
      ),
    ).toContain("buyer_confirmed_not_allowed");
  });
});

describe("excerpt limits (US3)", () => {
  it("stores a short excerpt, withholds an over-length one, and withholds for citation-only sources", () => {
    expect(record({ excerpt: "short quote" }).signal.excerpt).toBe("short quote");
    const long = record({
      observation: "Second distinct observation about a platform change",
      excerpt: "x".repeat(301),
    }).signal;
    expect(long.excerpt).toBeNull();
    expect(long.excerptWithheldReason).toBe("too_long");
    expect(long.source.ref).toBe("https://example.org/ig/1");
    const noStore = record({
      observation: "Third distinct observation about hiring",
      source: { sourceId: THIRD_PARTY, ref: "https://news.example/a" },
      excerpt: "quote",
    }).signal;
    expect(noStore.excerpt).toBeNull();
    expect(noStore.excerptWithheldReason).toBe("source_no_storage");
  });

  it("creates inline sources citation-only, and a source limit cannot exceed the global ceiling", () => {
    const r = record({
      source: { name: "Regional newsletter", kind: "third_party", ref: "https://news.example/b" },
      excerpt: "quote",
      observation: "Inline source observation text",
    });
    expect(r.signal.excerptWithheldReason).toBe("source_no_storage");
    const admin = human("admin-1");
    expect(
      codes(() =>
        sources.create(admin, {
          name: "Big quotes",
          kind: "official_publication",
          storageRule: "excerpt",
          excerptMaxChars: 900,
        }),
      ),
    ).toContain("excerpt_limit_above_global_ceiling");
    const short = sources.create(admin, {
      name: "Short quotes",
      kind: "official_publication",
      storageRule: "excerpt",
      excerptMaxChars: 10,
    });
    const s = record({
      source: { sourceId: short.id, ref: "https://example.org/s" },
      excerpt: "this is longer than ten",
      observation: "Short-limit source observation",
    }).signal;
    expect(s.excerptWithheldReason).toBe("too_long");
    expect(
      codes(() =>
        sources.create(admin, {
          name: "Cite only",
          kind: "other",
          storageRule: "citation_only",
          excerptMaxChars: 50,
        }),
      ),
    ).toContain("citation_only_has_no_excerpt_limit");
  });
});

describe("de-duplication (US4)", () => {
  it("is idempotent for an identical submission", () => {
    const first = record();
    const audits = count("audit_event");
    const outbox = count("outbox_event");
    const second = record();
    expect(second.outcome).toBe("already_exists");
    expect(second.signal.id).toBe(first.signal.id);
    expect(count("signal")).toBe(1);
    expect(count("signal_provenance")).toBe(1);
    expect(count("audit_event")).toBe(audits);
    expect(count("outbox_event")).toBe(outbox);
  });

  it("merges a lightly reworded copy from the same source and keeps the original dates", () => {
    const first = record();
    const again = record({ observation: first.signal.observation.replace(/\.$/, "") + " " });
    expect(again.outcome).toBe("already_exists");
    const reworded = record({
      observation: "The exchange published an updated implementation guide for claims attachment.",
    });
    expect(reworded.outcome).toBe("merged");
    expect(reworded.mergeKind).toBe("merged_duplicate");
    expect(reworded.signal.id).toBe(first.signal.id);
    expect(reworded.signal.observedAt).toBe(first.signal.observedAt);
    expect(reworded.signal.observation).toBe(first.signal.observation);
    expect(reworded.signal.provenance.map((p) => p.kind)).toEqual([
      "first_recorded",
      "merged_duplicate",
    ]);
    expect(count("signal")).toBe(1);
    // Submitting the reworded text again changes nothing.
    expect(
      record({
        observation:
          "The exchange published an updated implementation guide for claims attachment.",
      }).outcome,
    ).toBe("already_exists");
    expect(count("signal_provenance")).toBe(2);
  });

  it("holds one RFP on two portals as one signal with both sources", () => {
    const a = record({
      typeKey: "procurement_notice",
      source: {
        sourceId: OFFICIAL,
        ref: "https://portal-a.example/rfp/2026-17",
        itemKey: "RFP-2026-17",
      },
      observation: "RFP 2026-17 for a data platform was issued.",
    });
    const b = record({
      typeKey: "procurement_notice",
      source: {
        sourceId: THIRD_PARTY,
        ref: "https://portal-b.example/bids/17",
        itemKey: "RFP-2026-17",
      },
      observation: "Request for proposals 2026-17: data platform modernisation.",
    });
    expect(b.outcome).toBe("merged");
    expect(b.mergeKind).toBe("republication");
    expect(b.signal.id).toBe(a.signal.id);
    expect(count("signal")).toBe(1);
    const sourcesSeen = new Set(b.signal.provenance.map((p) => p.sourceId));
    expect(sourcesSeen.size).toBe(2);
  });

  it("keeps different content and different types separate", () => {
    const a = record();
    const b = record({ observation: "Hospital hired a new chief data officer last week" });
    const c = record({ typeKey: "onboarding_delay" });
    expect(new Set([a.signal.id, b.signal.id, c.signal.id]).size).toBe(3);
  });

  it("keeps an approved signal approved with the new-provenance flag, and the flag clears by review", () => {
    const a = record();
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    const merged = record({
      observation: "The exchange published an updated implementation guide for claims attachment.",
    });
    expect(merged.signal.reviewStatus).toBe("approved");
    expect(merged.signal.flags.newProvenanceSinceReview).toBe(true);
    expect(merged.signal.observation).toBe(a.signal.observation);
    const cleared = reviews.review(reviewer(), a.signal.id, { decision: "clear_flag" });
    expect(cleared.flags.newProvenanceSinceReview).toBe(false);
  });
});

describe("freshness and current evidence (US6)", () => {
  it("counts only approved, fresh signals and follows each type's window", () => {
    const b = record();
    const f = record({
      typeKey: "capability_gap_hiring",
      observation: "Posted for a data engineer",
      publishedAt: "2026-11-09T00:00:00.000Z",
    });
    reviews.review(reviewer(), b.signal.id, { decision: "approve" });
    reviews.review(reviewer(), f.signal.id, { decision: "approve" });
    const current = () =>
      db.transaction((tx) => currentEvidence(tx, "acc-1", clock.now)).map((s) => s.typeKey);
    expect(current().sort()).toEqual(["capability_gap_hiring", "implementation_guide_change"]);
    clock.now = new Date(Date.parse("2026-11-09T00:00:00.000Z") + 91 * DAY);
    expect(current()).toEqual(["implementation_guide_change"]);
    clock.now = new Date(Date.parse("2026-11-09T00:00:00.000Z") + 181 * DAY);
    expect(current()).toEqual([]);
    const detail = signals.get(f.signal.id, clock.now);
    expect(detail.stale).toBe(true);
    expect(detail.observation).toContain("data engineer");
    expect(listSignalsFresh("stale")).toHaveLength(2);
    expect(db.transaction((tx) => currentEvidence(tx, "acc-1", clock.now))).toEqual(
      listSignalsFresh("fresh"),
    );
  });

  const listSignalsFresh = (freshness: "fresh" | "stale") =>
    db
      .transaction((tx) => listSignals(tx, { accountId: "acc-1", freshness }, clock.now))
      .items.filter((s) => (freshness === "fresh" ? s.isCurrent : true));

  it("runs freshness from the collection date for an undated source and flags it", () => {
    const u = record({ publishedAt: undefined });
    expect(u.signal.undated).toBe(true);
    expect(u.signal.freshUntil).toBe(new Date(clock.now.getTime() + 180 * DAY).toISOString());
  });

  it("never counts pending, rejected or undecided contradictory signals", () => {
    const a = record();
    const current = () => db.transaction((tx) => currentEvidence(tx, "acc-1", clock.now)).length;
    expect(current()).toBe(0);
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    expect(current()).toBe(1);
    reviews.review(reviewer(), a.signal.id, { decision: "reject", reason: "source withdrawn" });
    expect(current()).toBe(0);
  });

  it("materialises the stale flag idempotently; correctness does not depend on it", () => {
    const a = record();
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    clock.now = new Date(clock.now.getTime() + 400 * DAY);
    expect(db.transaction((tx) => currentEvidence(tx, "acc-1", clock.now))).toHaveLength(0);
    expect(signals.markStale(human("system"))).toBe(1);
    expect(signals.markStale(human("system"))).toBe(0);
    expect((db.raw.prepare("SELECT freshness_state s FROM signal").get() as { s: string }).s).toBe(
      "stale",
    );
  });

  it("applies retention lazily on read and by job, keeping the citation", () => {
    record();
    clock.now = new Date(clock.now.getTime() + 40 * 30 * DAY);
    const seen = db.transaction((tx) => listSignals(tx, { accountId: "acc-1" }, clock.now))
      .items[0]!;
    expect(seen.observation).toBe("[removed by retention policy]");
    expect(seen.source.ref).toBe("https://example.org/ig/1");
    expect(signals.applyRetention(human("system"))).toBe(1);
    expect(signals.applyRetention(human("system"))).toBe(0);
    expect(signals.get(seen.id, clock.now).provenance.at(-1)!.kind).toBe("retention");
  });
});

describe("review (US5)", () => {
  it("approves, rejects only with a reason, keeps history and refuses non-humans", () => {
    const a = record();
    expect(codes(() => reviews.review(reviewer(), a.signal.id, { decision: "reject" }))).toContain(
      "reason_required",
    );
    expect(codes(() => reviews.review(ai, a.signal.id, { decision: "approve" }))).toContain(
      "reviewer_must_be_human",
    );
    const approved = reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    expect(approved.reviewStatus).toBe("approved");
    expect(approved.observation).toBe(a.signal.observation);
    const rejected = reviews.review(reviewer(), a.signal.id, {
      decision: "reject",
      reason: "withdrawn by source",
    });
    expect(rejected.reviewStatus).toBe("rejected");
    const again = reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    expect(again.reviews.map((r) => r.decision)).toEqual(["approve", "reject", "approve"]);
    expect(codes(() => reviews.review(reviewer(), "missing", { decision: "approve" }))).toContain(
      "unknown_signal",
    );
  });

  it("changes reliability only with a reason", () => {
    const a = record();
    expect(
      codes(() =>
        reviews.review(reviewer(), a.signal.id, { decision: "approve", reliability: "low" }),
      ),
    ).toContain("reason_required_for_reliability_change");
    const r = reviews.review(reviewer(), a.signal.id, {
      decision: "approve",
      reason: "secondary report",
      reliability: "low",
    });
    expect(r.reliability).toBe("low");
  });

  it("keeps both of two conflicting equal-reliability signals, flags both, and picks neither", () => {
    const a = record({
      accountId: "acc-1",
      observation: "Lakeshore states the migration is complete.",
      source: { sourceId: OFFICIAL, ref: "https://evidence.example/lakeshore-a" },
    });
    const b = record({
      accountId: "acc-1",
      observation: "Lakeshore states the migration is still in progress.",
      source: { sourceId: OFFICIAL, ref: "https://evidence.example/lakeshore-b" },
    });
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    reviews.review(reviewer(), b.signal.id, { decision: "approve" });
    const flagged = reviews.review(reviewer(), a.signal.id, {
      decision: "contradict",
      contradictsSignalId: b.signal.id,
    });
    expect(flagged.reviewStatus).toBe("contradictory");
    expect(flagged.contradictory).toEqual([{ entityType: "signal", entityId: b.signal.id }]);
    expect(signals.get(b.signal.id, clock.now).reviewStatus).toBe("contradictory");
    expect(signals.get(a.signal.id).reliability).toBe(signals.get(b.signal.id).reliability);
    expect(db.transaction((tx) => currentEvidence(tx, "acc-1", clock.now))).toHaveLength(0);
    expect(count("signal")).toBe(2);
    expect(
      (
        db.raw.prepare("SELECT resolved_at r FROM signal_contradiction").get() as {
          r: string | null;
        }
      ).r,
    ).toBeNull();
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    reviews.review(reviewer(), b.signal.id, {
      decision: "reject",
      reason: "the later notice supersedes it",
    });
    expect(
      (
        db.raw.prepare("SELECT resolved_at r FROM signal_contradiction").get() as {
          r: string | null;
        }
      ).r,
    ).not.toBeNull();
    expect(
      codes(() =>
        reviews.review(reviewer(), a.signal.id, {
          decision: "contradict",
          contradictsSignalId: a.signal.id,
        }),
      ),
    ).toContain("cannot_contradict_itself");
  });

  it("filters the feed by every dimension and returns newest first with keyset pages", () => {
    const a = record({
      relevance: { icp: ["icp1"], capability: ["fhir_mapping"], offer: ["audit"] },
      extractionConfidence: "high",
    });
    const b = record({
      typeKey: "program_announcement",
      observation: "A new program launched",
      accountId: "acc-3",
      source: { sourceId: THIRD_PARTY, ref: "https://n.example/p" },
    });
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    const feed = (f: Parameters<typeof listSignals>[1]) =>
      db.transaction((tx) => listSignals(tx, f, clock.now)).items.map((s) => s.id);
    expect(feed({})).toEqual([b.signal.id, a.signal.id]);
    expect(feed({ type: "program_announcement" })).toEqual([b.signal.id]);
    expect(feed({ category: "B" })).toEqual([a.signal.id]);
    expect(feed({ icp: "icp1" })).toEqual([a.signal.id]);
    expect(feed({ capability: "fhir_mapping", offer: "audit" })).toEqual([a.signal.id]);
    expect(feed({ accountId: "acc-3" })).toEqual([b.signal.id]);
    expect(feed({ sourceId: THIRD_PARTY })).toEqual([b.signal.id]);
    expect(feed({ confidence: "high" })).toEqual([a.signal.id]);
    expect(feed({ reviewStatus: "pending" })).toEqual([b.signal.id]);
    expect(feed({ freshness: "stale" })).toEqual([]);
    const page = db.transaction((tx) => listSignals(tx, { limit: 1 }, clock.now));
    expect(page.nextCursor).toBe(b.signal.id);
    expect(feed({ cursor: page.nextCursor! })).toEqual([a.signal.id]);
  });

  it("includes signals of accounts merged into the survivor", () => {
    const orig = record({ accountId: "acc-1" });
    const viaMerged = record({
      accountId: "acc-2",
      observation: "Recorded against the merged-away account",
    });
    expect(viaMerged.signal.accountId).toBe("acc-1");
    const timeline = db.transaction((tx) =>
      listSignals(tx, { accountId: "acc-2" }, clock.now),
    ).items;
    expect(timeline.map((s) => s.id).sort()).toEqual([orig.signal.id, viaMerged.signal.id].sort());
    // A signal recorded before a merge keeps its original account id and still shows on the survivor.
    db.raw
      .prepare(
        "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('acc-4','Late merge','late merge','2026-01-01','2026-01-01')",
      )
      .run();
    const early = record({ accountId: "acc-4", observation: "Recorded while acc-4 was live" });
    db.raw.exec("UPDATE account SET merged_into = 'acc-1' WHERE id = 'acc-4'");
    expect(early.signal.accountId).toBe("acc-4");
    expect(
      db
        .transaction((tx) => listSignals(tx, { accountId: "acc-1" }, clock.now))
        .items.map((s) => s.id),
    ).toContain(early.signal.id);
  });
});

describe("funding and regulatory rules (US7, US8)", () => {
  it("keeps a grant announcement as funding context and requires a citation for budget approval", () => {
    const g = record({
      typeKey: "grant_funding_announcement",
      observation: "A state grant of $2M was announced.",
    });
    expect(g.signal.fundingClass).toBe("context");
    expect(
      codes(() =>
        record({
          typeKey: "grant_funding_announcement",
          observation: "Another grant note",
          fundingClass: "budget_approval_evidence",
          approvalCitation: "x",
        }),
      ),
    ).toContain("grant_announcement_is_context_only");
    expect(
      codes(() =>
        record({
          typeKey: "budget_approval_statement",
          observation: "Budget approved",
          fundingClass: "budget_approval_evidence",
        }),
      ),
    ).toContain("approval_citation_required");
    const ok = record({
      typeKey: "budget_approval_statement",
      observation: "The board approved the FY27 data platform budget.",
      fundingClass: "budget_approval_evidence",
      approvalCitation: "Board minutes 2026-10-01: budget approved",
    });
    expect(ok.signal.fundingClass).toBe("budget_approval_evidence");
    expect(JSON.stringify(ok.signal)).not.toMatch(/funding_?path/i);
    expect(
      codes(() => record({ observation: "Non-funding type", fundingClass: "context" })),
    ).toContain("funding_class_not_allowed");
  });

  it("flags regulatory signals, refuses HTI-5 as final and clears the flag only by re-verification", () => {
    const r = record({
      typeKey: "regulatory_ecosystem_item",
      observation: "CMS-0057-F prior authorization API deadline noted",
      regulatoryItem: "CMS-0057-F",
    });
    expect(r.signal.flags.contextOnly).toBe(true);
    expect(r.signal.flags.reverifyRequired).toBe(true);
    expect(r.signal.regulatoryStatus).toBe("unverified");
    expect(r.signal.externalUse).toBe("not_without_reverification");
    expect(
      codes(() =>
        record({
          typeKind: undefined,
          typeKey: "regulatory_ecosystem_item",
          observation: "HTI-5 rule text",
          regulatoryItem: "HTI-5",
          regulatoryStatus: "reported_final",
        } as Partial<RecordInput>),
      ),
    ).toContain("hti5_never_final");
    const proposed = record({
      typeKey: "regulatory_ecosystem_item",
      observation: "HTI-5 proposed rule discussion",
      regulatoryItem: "HTI-5",
      regulatoryStatus: "proposed",
    });
    expect(proposed.signal.regulatoryStatus).toBe("proposed");
    const cleared = reviews.review(reviewer(), r.signal.id, {
      decision: "reverify",
      reason: "checked against the federal register",
    });
    expect(cleared.flags.reverifyRequired).toBe(false);
    expect(cleared.externalUse).toBe("context_only");
    expect(cleared.flags.contextOnly).toBe(true);
    expect(
      codes(() =>
        reviews.review(reviewer(), r.signal.id, { decision: "reverify", reason: "again" }),
      ),
    ).toContain("nothing_to_reverify");
  });
});

describe("events, audit and privacy", () => {
  it("emits identifiers-only events and audits every change without content", () => {
    const a = record({ excerpt: "short quote" });
    record({
      observation: "The exchange published an updated implementation guide for claims attachment.",
    });
    reviews.review(reviewer(), a.signal.id, { decision: "approve" });
    const events = db.raw
      .prepare("SELECT type, payload FROM outbox_event ORDER BY rowid")
      .all() as { type: string; payload: string }[];
    expect(events.map((e) => e.type)).toEqual([
      "signal.discovered",
      "signal.discovered",
      "signal.reviewed",
    ]);
    expect(JSON.parse(events[1]!.payload).merged).toBe(true);
    const dump =
      JSON.stringify(events) + JSON.stringify(db.raw.prepare("SELECT * FROM audit_event").all());
    expect(dump).not.toContain("implementation guide");
    expect(dump).not.toContain("short quote");
    const actions = (
      db.raw.prepare("SELECT action FROM audit_event ORDER BY rowid").all() as { action: string }[]
    ).map((r) => r.action);
    expect(actions).toEqual(["signal.record", "signal.merge", "signal.review.approve"]);
  });

  it("clears the contact link on erasure and keeps the account-level observation", () => {
    const a = record({ contactId: "con-1" });
    db.transaction((tx) => signals.clearContact(tx, "con-1", human("system")));
    const d = signals.get(a.signal.id);
    expect(d.contactId).toBeNull();
    expect(d.observation).toBe(a.signal.observation);
    expect(d.provenance.at(-1)!.kind).toBe("contact_erased");
  });

  it("publishes a new taxonomy version; old signals keep theirs and retired types are refused", () => {
    const a = record();
    const v = sources.publishTaxonomyVersion(human("admin-1"), [
      {
        key: "only_type",
        category: "A",
        label: "Only",
        kind: "general",
        defaultFreshnessDays: 10,
        defaultReliability: "medium",
        contextOnly: false,
      },
    ]);
    expect(v).toBe(2);
    expect(signals.get(a.signal.id).taxonomyVersion).toBe(1);
    expect(codes(() => record({ observation: "Uses a retired type" }))).toContain(
      "unknown_or_retired_type",
    );
    expect(
      record({ typeKey: "only_type", observation: "Uses the new type" }).signal.taxonomyVersion,
    ).toBe(2);
  });

  it("marks a source unavailable without changing reliability and notes it in provenance", () => {
    const a = record();
    sources.setAvailability(human("admin-1"), OFFICIAL, false);
    const d = signals.get(a.signal.id);
    expect(d.source.unavailableSince).not.toBeNull();
    expect(d.reliability).toBe(a.signal.reliability);
    expect(d.provenance.at(-1)!.kind).toBe("source_unavailable");
  });
});
