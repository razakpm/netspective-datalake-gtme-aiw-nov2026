import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { keyedEmailHash } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import type { CatalogueActor } from "../src/platform/catalogue.js";
import {
  ContactsService,
  SuppressionService,
  checkSuppression,
} from "../src/modules/contacts/index.js";

// Task T021: suppression and first-party contact creation (feature 002 slice built in feature 006).
const KEY = "k".repeat(32);
const now = () => new Date("2026-11-23T10:00:00.000Z");
const human: CatalogueActor = {
  userId: "u1",
  actorType: "human",
  correlationId: "corr-1",
  permissions: [],
  now,
};

function setup() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  db.raw
    .prepare(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Northvale','northvale','t','t')",
    )
    .run();
  return {
    db,
    contacts: new ContactsService(db, { hashKey: KEY }),
    suppression: new SuppressionService(db),
  };
}
const ctx = { actorId: "system", actorType: "system" as const, correlationId: "c", now };
const audits = (db: SqliteDatabase, action: string) =>
  (
    db.raw.prepare("SELECT count(*) c FROM audit_event WHERE action = ?").get(action) as {
      c: number;
    }
  ).c;

describe("contacts: find or create by business email", () => {
  it("creates a business contact with the source, basis and a relationship, and audits it", () => {
    const { db, contacts } = setup();
    const r = db.transaction((tx) =>
      contacts.findOrCreateByBusinessEmail(
        tx,
        {
          email: "Alex@Northvale-HIE.example",
          role: "Integration Lead",
          accountId: "a1",
          source: "first_party_form",
          basis: "consent",
          documentedOrigin: "Offer 5 form",
        },
        ctx,
      ),
    );
    expect(r).toMatchObject({ ok: true, created: true, domain: "northvale-hie.example" });
    if (!r.ok) throw new Error("expected ok");
    expect(r.emailHash).toBe(keyedEmailHash("alex@northvale-hie.example", KEY));
    expect(db.raw.prepare("SELECT business_email, email_hash FROM contact").get()).toEqual({
      business_email: "alex@northvale-hie.example",
      email_hash: r.emailHash,
    });
    expect(db.raw.prepare("SELECT source, basis FROM contact_source").get()).toEqual({
      source: "first_party_form",
      basis: "consent",
    });
    expect(db.raw.prepare("SELECT title_stated FROM account_contact_relationship").get()).toEqual({
      title_stated: "Integration Lead",
    });
    expect(audits(db, "contact.create")).toBe(1);
  });
  it("reuses the contact for the same email and never makes a duplicate", () => {
    const { db, contacts } = setup();
    const input = {
      email: "alex@northvale-hie.example",
      role: "Lead",
      accountId: "a1",
      source: "first_party_form" as const,
      basis: "consent",
      documentedOrigin: "form",
    };
    const a = db.transaction((tx) => contacts.findOrCreateByBusinessEmail(tx, input, ctx));
    const b = db.transaction((tx) => contacts.findOrCreateByBusinessEmail(tx, input, ctx));
    expect(a.ok && b.ok && a.contactId === b.contactId && !b.created).toBe(true);
    expect((db.raw.prepare("SELECT count(*) c FROM contact").get() as { c: number }).c).toBe(1);
    expect(
      (db.raw.prepare("SELECT count(*) c FROM account_contact_relationship").get() as { c: number })
        .c,
    ).toBe(1);
  });
  it("never creates a contact from a personal address", () => {
    const { db, contacts } = setup();
    const r = db.transaction((tx) =>
      contacts.findOrCreateByBusinessEmail(
        tx,
        {
          email: "pat@gmail.com",
          role: "x",
          accountId: "a1",
          source: "first_party_form",
          basis: "consent",
          documentedOrigin: "form",
        },
        ctx,
      ),
    );
    expect(r).toEqual({ ok: false, code: "personal_email" });
    expect((db.raw.prepare("SELECT count(*) c FROM contact").get() as { c: number }).c).toBe(0);
  });
});

describe("suppression", () => {
  it("adds a suppression with an audit record and the single check sees it at every scope", () => {
    const { db, suppression } = setup();
    db.raw.prepare("INSERT INTO contact (id, created_at, updated_at) VALUES ('c1','t','t')").run();
    expect(
      checkSuppression(db.raw, { contactId: "c1", accountId: "a1", emailHash: "h" }).suppressed,
    ).toBe(false);
    suppression.add(human, { scope: "contact", contactId: "c1", reason: "Asked to be removed" });
    expect(checkSuppression(db.raw, { contactId: "c1" })).toEqual({
      suppressed: true,
      scope: "contact",
    });
    suppression.add(human, { scope: "account", accountId: "a1", reason: "Account asked to stop" });
    expect(checkSuppression(db.raw, { accountId: "a1" })).toEqual({
      suppressed: true,
      scope: "account",
    });
    const hash = keyedEmailHash("pat.unsubscribed@example.org", KEY);
    suppression.add(human, { scope: "contact", emailHash: hash, reason: "Unsubscribed" });
    expect(checkSuppression(db.raw, { emailHash: hash })).toEqual({
      suppressed: true,
      scope: "email_hash",
    });
    expect(audits(db, "suppression.add")).toBe(3);
  });
  it("is never deleted or changed", () => {
    const { db, suppression } = setup();
    const { id } = suppression.add(human, { scope: "account", accountId: "a1", reason: "Stop" });
    expect(() => db.raw.prepare("DELETE FROM suppression_record WHERE id = ?").run(id)).toThrow(
      /append-only/,
    );
    expect(() =>
      db.raw.prepare("UPDATE suppression_record SET reason = 'x' WHERE id = ?").run(id),
    ).toThrow(/append-only/);
  });
  it("refuses a missing target, a short reason, PHI-like text and a non-person, with an audited refusal", () => {
    const { db, suppression } = setup();
    expect(() => suppression.add(human, { scope: "account", reason: "Stop now" })).toThrow();
    expect(() =>
      suppression.add(human, { scope: "account", accountId: "a1", reason: "ab" }),
    ).toThrow();
    expect(() =>
      suppression.add(human, {
        scope: "account",
        accountId: "a1",
        reason: "Patient SSN 123-45-6789",
      }),
    ).toThrow();
    expect(() =>
      suppression.add(
        { ...human, actorType: "system", userId: null },
        { scope: "account", accountId: "a1", reason: "Stop now" },
      ),
    ).toThrow();
    expect(
      (db.raw.prepare("SELECT count(*) c FROM suppression_record").get() as { c: number }).c,
    ).toBe(0);
    expect(audits(db, "suppression.add")).toBeGreaterThanOrEqual(3);
  });
});
