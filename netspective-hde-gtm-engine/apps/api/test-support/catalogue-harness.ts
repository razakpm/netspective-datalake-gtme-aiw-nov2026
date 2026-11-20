import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import {
  DEFAULT_PHRASE_RULES,
  effectiveClass,
  FOUNDATION_ROLE_PERMISSIONS,
  lintText,
  type ActorType,
  type ClaimClass,
  type RoleKey,
} from "@gtm/domain";
import { ClaimService } from "../src/modules/claims/index.js";
import {
  BookingService,
  CapacityService,
  OfferLimitations,
  OfferService,
  OfferStatusService,
} from "../src/modules/offers/index.js";
import type { CatalogueActor } from "../src/platform/catalogue.js";

// A catalogue stack on an in-memory database with all migrations and the feature 005 seed, a fake clock
// and actors for each role (feature 005 tests, task T014). Services are added to it as they are built.

/** Every required offer attribute, with wording that trips no restricted phrase. */
export const COMPLETE_PATCH = {
  name: "Complete test offer",
  format: "45-minute session, no PHI",
  targetIcp: "ICP1",
  buyerOutput: "A friction map of sender onboarding",
  buyerEffort: "One hour of one person",
  effortEstimate: { text: "About two days of preparation" },
  conversionPath: "Book a session, then scope a sprint",
  landingPagePromise: "See where senders stall in onboarding.",
  cta: "Book a session",
  intakeFields: ["Organisation", "Number of senders"],
  successHypotheses: ["Senders stall at onboarding"],
  sqlRuleRef: "sql-offer-test",
} as const;

export interface Who {
  userId: string;
  role: RoleKey;
}

/** Named people. The two designated claim approvers and the marketing approver hold `claims.approve`. */
export const PEOPLE = {
  lead: { userId: "lead-1", role: "sales_service_lead" },
  lead2: { userId: "lead-2", role: "sales_service_lead" },
  marketing: { userId: "marketing-1", role: "campaign_approver" },
  drafter: { userId: "drafter-1", role: "research_analyst" },
  analyst: { userId: "analyst-1", role: "research_analyst" },
  operator: { userId: "operator-1", role: "gtm_operator" },
  executive: { userId: "exec-1", role: "read_only_executive" },
  admin: { userId: "admin-1", role: "administrator" },
} as const satisfies Record<string, Who>;
export type PersonKey = keyof typeof PEOPLE;

export interface CatalogueHarnessOptions {
  /** Start of the fake clock. */
  start?: string;
  businessTimeZone?: string;
}

export function buildCatalogueHarness(options: CatalogueHarnessOptions = {}) {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const clock = { now: new Date(options.start ?? "2026-11-19T10:00:00.000Z") };
  const now = () => clock.now;
  const advance = (ms: number) => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const advanceDays = (days: number) => advance(days * 86_400_000);

  /** The acting caller for a named person, holding that role's permissions. */
  const actor = (
    who: PersonKey | Who = "lead",
    over: Partial<CatalogueActor> & { actorType?: ActorType } = {},
  ): CatalogueActor => {
    const person = typeof who === "string" ? PEOPLE[who] : who;
    return {
      userId: person.userId,
      actorType: "human",
      correlationId: "corr-test",
      permissions: FOUNDATION_ROLE_PERMISSIONS[person.role],
      now,
      ...over,
    };
  };
  const claims = new ClaimService(db, { evidenceDefaultExpiryMonths: 12 });
  const offers = new OfferService(db);
  const offerStatus = new OfferStatusService(db);
  const limitations = new OfferLimitations(db);
  const capacity = new CapacityService(db, { businessTimeZone: options.businessTimeZone ?? "UTC" });
  const bookings = new BookingService(db, { businessTimeZone: options.businessTimeZone ?? "UTC" });
  /** Give an offer a complete new version and take it through review to approved (service lead). */
  const approveOffer = (offerId: string, patch: Record<string, unknown> = {}) => {
    const lead = actor("lead");
    const head = offers.get(lead, offerId);
    const v = offers.createVersion(
      lead,
      offerId,
      { patch: { ...COMPLETE_PATCH, ...patch }, reason: "Complete" },
      head.lockNo,
    );
    advance(1000);
    offerStatus.moveStatus(lead, offerId, v.versionNo, "internally_reviewed", "Reviewed");
    advance(1000);
    offerStatus.moveStatus(lead, offerId, v.versionNo, "approved", "Approved");
    return v.versionNo;
  };
  let seq = 0;
  /** An approved claim with valid evidence, inserted directly (the review flow has its own tests). */
  const insertApprovedClaim = (
    text: string,
    over: {
      effectiveClass?: ClaimClass;
      expiresAt?: string;
      withdrawn?: boolean;
      evidence?: boolean;
    } = {},
  ): string => {
    const id = `claim-approved-${++seq}`;
    const cls =
      over.effectiveClass ??
      effectiveClass(
        null,
        lintText(text, { rules: DEFAULT_PHRASE_RULES }).map((m) => m.class),
      );
    const at = now().toISOString();
    db.raw
      .prepare(
        "INSERT INTO claim (id, text, declared_class, effective_class, status, drafted_by, drafted_at, version_no) VALUES (?,?,NULL,?,'approved','someone-else',?,1)",
      )
      .run(id, text, cls, at);
    if (over.evidence !== false) {
      db.raw
        .prepare(
          "INSERT INTO claim_evidence (id, claim_id, kind, reference, owner, added_by, added_at, expires_at, withdrawn_at, withdrawn_by) VALUES (?,?,'document','doc-1','owner','someone-else',?,?,?,?)",
        )
        .run(
          `ev-${id}`,
          id,
          at,
          over.expiresAt ?? "2027-11-19T10:00:00.000Z",
          over.withdrawn ? at : null,
          over.withdrawn ? "someone-else" : null,
        );
    }
    return id;
  };
  const count = (table: string, where = "1=1") =>
    (db.raw.prepare(`SELECT count(*) c FROM ${table} WHERE ${where}`).get() as { c: number }).c;
  const outbox = (type: string): Record<string, unknown>[] =>
    (
      db.raw
        .prepare("SELECT payload FROM outbox_event WHERE type = ? ORDER BY rowid")
        .all(type) as { payload: string }[]
    ).map((e) => JSON.parse(e.payload) as Record<string, unknown>);
  const audit = (action: string) =>
    db.raw
      .prepare(
        "SELECT actor_id, outcome, entity_id, after_summary FROM audit_event WHERE action = ? ORDER BY rowid",
      )
      .all(action) as {
      actor_id: string | null;
      outcome: string;
      entity_id: string | null;
      after_summary: string | null;
    }[];
  const anyText = (needle: RegExp): boolean =>
    needle.test(
      JSON.stringify([
        db.raw.prepare("SELECT payload FROM outbox_event").all(),
        db.raw.prepare("SELECT before_summary, after_summary FROM audit_event").all(),
      ]),
    );

  return {
    db,
    clock,
    now,
    advance,
    advanceDays,
    actor,
    claims,
    offers,
    offerStatus,
    limitations,
    capacity,
    bookings,
    approveOffer,
    insertApprovedClaim,
    count,
    outbox,
    audit,
    anyText,
    businessTimeZone: options.businessTimeZone ?? "UTC",
  };
}

export type CatalogueHarness = ReturnType<typeof buildCatalogueHarness>;
