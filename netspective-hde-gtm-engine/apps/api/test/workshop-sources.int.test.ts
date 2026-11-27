import { migrate, seedReference, SqliteDatabase } from "@gtm/db";
import { describe, expect, it } from "vitest";
import { loadRequestForWorkshop } from "../src/modules/engagement/index.js";
import { evidenceFor } from "../src/modules/icp/index.js";

// Feature 007 task T019: the read-only exports the workshops module uses. No permission check here: the
// caller checks.
const now = "2026-11-27T10:00:00.000Z";

function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  db.transaction((tx) => seedReference(tx));
  const run = (sql: string, ...args: (string | number | null)[]) =>
    db.raw.prepare(sql).run(...args);
  run(
    "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a1','Northvale HIE','northvale hie',?,?)",
    now,
    now,
  );
  run("INSERT INTO contact (id, created_at, updated_at) VALUES ('c1',?,?)", now, now);
  const request = (id: string, kind: string, state: string, linked: boolean) =>
    run(
      "INSERT INTO offer_request (id, offer_id, form_slug, kind, state, email_hash, account_id, contact_id, submitted_at) VALUES (?, 'offer-1', 'sender-onboarding-friction-map', ?, ?, 'eh', ?, ?, ?)",
      id,
      kind,
      state,
      linked ? "a1" : null,
      linked ? "c1" : null,
      now,
    );
  return { db, run, request };
}

describe("loadRequestForWorkshop", () => {
  it("returns the request with its typed intake", () => {
    const h = fresh();
    h.request("q1", "intake", "linked", true);
    h.run(
      "INSERT INTO intake_submission (id, request_id, offer_id, kind, schema_version, payload_json, classification, submitted_at) VALUES ('i1','q1','offer-1','offer_1',1,?, 'non_phi', ?)",
      JSON.stringify({ organisationName: "Northvale HIE" }),
      now,
    );
    expect(loadRequestForWorkshop(h.db.raw, "q1")).toEqual({
      state: "linked",
      kind: "intake",
      offerId: "offer-1",
      accountId: "a1",
      contactId: "c1",
      intake: { id: "i1", kind: "offer_1", payload: { organisationName: "Northvale HIE" } },
    });
  });
  it("returns no intake for a request that has none, and null for an unknown request", () => {
    const h = fresh();
    h.request("q2", "working_session", "received", false);
    expect(loadRequestForWorkshop(h.db.raw, "q2")).toMatchObject({
      state: "received",
      kind: "working_session",
      accountId: null,
      contactId: null,
      intake: null,
    });
    expect(loadRequestForWorkshop(h.db.raw, "missing")).toBeNull();
  });
});

describe("evidenceFor", () => {
  it("returns the account's evidence records in the order recorded, with their text", () => {
    const h = fresh();
    const add = (id: string, account: string, status: string, what: string) =>
      h.run(
        "INSERT INTO evidence_reference (id, account_id, topic, what, where_ref, observed_at, recorded_at, status) VALUES (?,?, 'sender_onboarding_friction', ?, 'ref', ?, ?, ?)",
        id,
        account,
        what,
        now,
        now,
        status,
      );
    h.run(
      "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES ('a2','Other','other',?,?)",
      now,
      now,
    );
    add("ev1", "a1", "observed", "Repeated onboarding delays.");
    add("ev2", "a2", "observed", "Another account.");
    add("ev3", "a1", "contradictory", "Onboarding was reported as quick.");
    expect(h.db.transaction((tx) => evidenceFor(tx, "a1"))).toEqual([
      {
        id: "ev1",
        topic: "sender_onboarding_friction",
        status: "observed",
        text: "Repeated onboarding delays.",
      },
      {
        id: "ev3",
        topic: "sender_onboarding_friction",
        status: "contradictory",
        text: "Onboarding was reported as quick.",
      },
    ]);
    expect(evidenceFor(h.db.raw, "nobody")).toEqual([]);
  });
});
