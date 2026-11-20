import { createHash } from "node:crypto";
import { blankSnapshot, type OfferSnapshot } from "@gtm/domain";
import type { Tx } from "../sqlite/database.js";

// Feature 005 reference data (task T011): offers, paid engagement types, capability slots and capacity
// limits. Only facts recorded in the repository are written (docs/context/01-guardrails.md); every other
// attribute is null, which means "to be provided" (open question #47). Idempotent. The capacity limits
// and the SQL rule identifiers are hypotheses (open question #48). The restricted phrase list is seeded
// separately with the default rules.

export const SEED_AT = "2026-11-19T00:00:00.000Z";
const at = (offsetMs: number) => new Date(Date.parse(SEED_AT) + offsetMs).toISOString();

interface SeedOffer {
  number: number;
  key: string;
  baseline: boolean;
  snapshot: OfferSnapshot;
}

const withFacts = (facts: Partial<OfferSnapshot>): OfferSnapshot => ({
  ...blankSnapshot(),
  ...facts,
});

export const SEED_OFFERS: readonly SeedOffer[] = [
  {
    number: 1,
    key: "sender-onboarding-friction-map",
    baseline: true,
    snapshot: withFacts({
      name: "Sender Onboarding Friction Map",
      format: "45-minute session, no PHI",
      targetIcp: "ICP1: state or regional HIE, Medicaid program operator",
      sqlRuleRef: "sql-offer-1",
      paidTypeKey: "sender_readiness_sprint",
    }),
  },
  { number: 2, key: "offer-2", baseline: false, snapshot: blankSnapshot() },
  { number: 3, key: "offer-3", baseline: false, snapshot: blankSnapshot() },
  { number: 4, key: "offer-4", baseline: false, snapshot: blankSnapshot() },
  {
    number: 5,
    key: "ccda-to-fhir-mapping-decision-register",
    baseline: true,
    snapshot: withFacts({
      name: "CCDA-to-FHIR Mapping Decision Register",
      format: "gated download",
      conversionPath: "ICP1 routes to Offer 1; ICP2 routes to Offer 6. A download is never an SQL.",
      sqlRuleRef: "sql-offer-5",
    }),
  },
  {
    number: 6,
    key: "pilot-input-trace-workshop",
    baseline: true,
    snapshot: withFacts({
      name: "Pilot Input Trace Workshop",
      format: "90-minute session, 10 fields, no data leaves",
      targetIcp: "ICP2: mid-size health system with a stalled data-dependent AI or analytics pilot",
      sqlRuleRef: "sql-offer-6",
      paidTypeKey: "input_audit",
    }),
  },
  { number: 7, key: "offer-7", baseline: false, snapshot: blankSnapshot() },
  {
    number: 8,
    key: "offer-8",
    baseline: false,
    snapshot: withFacts({ paidTypeKey: "resilience_review" }),
  },
  { number: 9, key: "offer-9", baseline: false, snapshot: blankSnapshot() },
  { number: 10, key: "offer-10", baseline: false, snapshot: blankSnapshot() },
];

interface SeedPaidType {
  key: string;
  name: string;
  weeksMin: number | null;
  weeksMax: number | null;
  scope: string[];
  scopeConfirmed: boolean;
  status: "active" | "inactive";
  deliverables: string[];
}

export const SEED_PAID_TYPES: readonly SeedPaidType[] = [
  {
    key: "sender_readiness_sprint",
    name: "Sender Readiness Sprint",
    weeksMin: 6,
    weeksMax: 6,
    scope: ["3 to 5 senders", "one format"],
    scopeConfirmed: true,
    status: "active",
    deliverables: ["per-sender rejection reporting", "header contract", "raw-first landing"],
  },
  {
    key: "input_audit",
    name: "Input Audit",
    weeksMin: 6,
    weeksMax: 8,
    scope: ["one use case", "1 to 2 sources"],
    scopeConfirmed: true,
    status: "active",
    deliverables: ["lineage-tracked feed", "go/no-go memo"],
  },
  {
    key: "resilience_review",
    name: "Resilience Review",
    weeksMin: null,
    weeksMax: null,
    scope: [],
    scopeConfirmed: false,
    status: "inactive",
    deliverables: [],
  },
];

export const SEED_LIMITATION = {
  id: "limitation-offer-7-evaluation",
  offerId: "offer-7",
  key: "evaluation_is_buyer_prompt_only",
  wording: "Evaluation is a buyer prompt only",
};

export const SEED_CAPACITY: readonly {
  offerId: string;
  period: "week" | "month";
  limit: number;
}[] = [
  { offerId: "offer-6", period: "month", limit: 3 },
  { offerId: "offer-1", period: "week", limit: 3 },
];

/** Stable JSON: keys sorted, so the stored hash is reproducible. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const snapshotHash = (snapshot: OfferSnapshot): string =>
  createHash("sha256").update(canonical(snapshot)).digest("hex");

export function seedFeature005(tx: Tx): void {
  const paidType = tx.prepare(
    "INSERT OR IGNORE INTO paid_engagement_type (key, name, weeks_min, weeks_max, scope_json, scope_confirmed, status, lock_no) VALUES (?,?,?,?,?,?,?,1)",
  );
  const deliverable = tx.prepare(
    "INSERT OR IGNORE INTO paid_engagement_deliverable (id, type_key, text, in_source, approval, approved_by, decided_at) VALUES (?,?,?,1,'approved',NULL,NULL)",
  );
  for (const t of SEED_PAID_TYPES) {
    paidType.run(
      t.key,
      t.name,
      t.weeksMin,
      t.weeksMax,
      JSON.stringify(t.scope),
      t.scopeConfirmed ? 1 : 0,
      t.status,
    );
    for (const text of t.deliverables)
      deliverable.run(`deliverable-${t.key}-${slug(text)}`, t.key, text);
  }

  const head = tx.prepare(
    "INSERT OR IGNORE INTO engagement_offer (id, number, key, latest_version_no, in_force_version_no, lock_no, created_at) VALUES (?,?,?,1,?,1,?)",
  );
  const version = tx.prepare(
    "INSERT OR IGNORE INTO offer_version (offer_id, version_no, snapshot_json, snapshot_hash, reason, created_by, created_at) VALUES (?,1,?,?,?,'seed',?)",
  );
  const status = tx.prepare(
    "INSERT OR IGNORE INTO offer_version_status (id, offer_id, version_no, status, changed_by, note, changed_at) VALUES (?,?,1,?,'seed',?,?)",
  );
  for (const o of SEED_OFFERS) {
    const id = `offer-${o.number}`;
    head.run(id, o.number, o.key, o.baseline ? 1 : null, SEED_AT);
    version.run(
      id,
      JSON.stringify(o.snapshot),
      snapshotHash(o.snapshot),
      "Seed from repository facts; every other attribute is to be provided",
      SEED_AT,
    );
    status.run(`seed-status-${id}-draft`, id, "draft", "Seeded", SEED_AT);
    if (o.baseline) {
      status.run(
        `seed-status-${id}-internally_reviewed`,
        id,
        "internally_reviewed",
        "Baseline decision recorded by the seed",
        at(1),
      );
      status.run(
        `seed-status-${id}-approved`,
        id,
        "approved",
        "Baseline approval recorded once by the seed; attributes are incomplete until a person fills them",
        at(2),
      );
    }
  }

  tx.prepare(
    "INSERT OR IGNORE INTO offer_limitation (id, offer_id, key, wording, active) VALUES (?,?,?,?,1)",
  ).run(SEED_LIMITATION.id, SEED_LIMITATION.offerId, SEED_LIMITATION.key, SEED_LIMITATION.wording);

  const capacity = tx.prepare(
    "INSERT OR IGNORE INTO offer_capacity (id, offer_id, period_kind, limit_sessions, effective_from, set_by, set_at, reason) VALUES (?,?,?,?,?,'seed',?,?)",
  );
  for (const c of SEED_CAPACITY) {
    capacity.run(
      `capacity-seed-${c.offerId}-${c.period}`,
      c.offerId,
      c.period,
      c.limit,
      "2026-01-01",
      SEED_AT,
      "Initial validation limit (hypothesis, open questions 6 and 7)",
    );
  }

  const slot = tx.prepare(
    "INSERT OR IGNORE INTO service_capability (id, slot, public_claim_status, lock_no) VALUES (?,?,'not_approved',1)",
  );
  for (let n = 1; n <= 19; n++) slot.run(`capability-${String(n).padStart(2, "0")}`, n);
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, "-");
