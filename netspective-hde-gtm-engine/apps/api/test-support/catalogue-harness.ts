import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { FOUNDATION_ROLE_PERMISSIONS, type ActorType, type RoleKey } from "@gtm/domain";
import type { CatalogueActor } from "../src/platform/catalogue.js";

// A catalogue stack on an in-memory database with all migrations and the feature 005 seed, a fake clock
// and actors for each role (feature 005 tests, task T014). Services are added to it as they are built.

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
    count,
    outbox,
    audit,
    anyText,
    businessTimeZone: options.businessTimeZone ?? "UTC",
  };
}

export type CatalogueHarness = ReturnType<typeof buildCatalogueHarness>;
