import { describe, expect, it } from "vitest";
import { migrate, SqliteDatabase } from "../src/index.js";
import { COLUMN_CLASSIFICATION } from "../src/classification.js";

// Migrations 0023 and 0024 (feature 007, data-model.md): constraints, triggers and the schema scan.
const now = "2026-11-27T00:00:00.000Z";
const later = "2026-11-28T00:00:00.000Z";
type V = string | number | null;
const TABLES = [
  "workshop",
  "workshop_state_history",
  "workshop_participant",
  "delivery_effort",
  "workshop_artifact",
  "workshop_brief",
  "workshop_finding",
  "workshop_output_document",
  "workshop_output_share",
];

function insert(db: SqliteDatabase, table: string, row: Record<string, V>) {
  const cols = Object.keys(row);
  db.raw
    .prepare(`INSERT INTO ${table} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`)
    .run(...Object.values(row));
}
function update(db: SqliteDatabase, table: string, id: string, change: Record<string, V>) {
  const cols = Object.keys(change);
  db.raw
    .prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`)
    .run(...Object.values(change), id);
}
const fails = (fn: () => void, pattern: RegExp = /./) => expect(fn).toThrow(pattern);
const remove = (db: SqliteDatabase, table: string, id: string) => () =>
  db.raw.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);

function fresh() {
  const db = new SqliteDatabase();
  migrate(db);
  insert(db, "account", {
    id: "a1",
    name: "Acme",
    name_normalised: "acme",
    created_at: now,
    updated_at: now,
  });
  insert(db, "contact", { id: "c1", created_at: now, updated_at: now });
  insert(db, "engagement_offer", {
    id: "o1",
    number: 1,
    key: "k1",
    latest_version_no: 1,
    lock_no: 1,
    created_at: now,
  });
  for (const n of ["1", "2"]) {
    insert(db, "offer_request", {
      id: `q${n}`,
      offer_id: "o1",
      form_slug: "k1",
      kind: "intake",
      email_hash: "eh",
      submitted_at: now,
    });
    insert(db, "intake_submission", {
      id: `i${n}`,
      request_id: `q${n}`,
      offer_id: "o1",
      kind: "offer_1",
      schema_version: 1,
      payload_json: "{}",
      classification: "non_phi",
      submitted_at: now,
    });
  }
  insert(db, "offer_session_booking", {
    id: "b1",
    offer_id: "o1",
    state: "booked",
    session_date: "2026-12-01",
    period_start: "2026-12-01",
    source: "workshop",
    recorded_by: "u1",
    recorded_at: now,
    updated_at: now,
  });
  return db;
}

const BOOKED = {
  scheduled_at: "2026-12-01T10:00:00.000Z",
  session_date: "2026-12-01",
  booking_id: "b1",
  booking_route: "manual",
};
const workshop = (db: SqliteDatabase, id = "w1", over: Record<string, V> = {}) =>
  insert(db, "workshop", {
    id,
    request_id: "q1",
    offer_id: "o1",
    intake_id: "i1",
    account_id: "a1",
    contact_id: "c1",
    state: "requested",
    duration_minutes: 45,
    lock_no: 1,
    created_by: "u1",
    created_at: now,
    updated_at: now,
    ...over,
  });
const history = (db: SqliteDatabase, id: string, over: Record<string, V> = {}) =>
  insert(db, "workshop_state_history", {
    id,
    workshop_id: "w1",
    to_state: "requested",
    changed_by: "u1",
    changed_at: now,
    ...over,
  });
const artifact = (db: SqliteDatabase, id = "ar1", over: Record<string, V> = {}) =>
  insert(db, "workshop_artifact", {
    id,
    workshop_id: "w1",
    kind: "specification",
    title: "Interface specification",
    reference: "Shared drive: interface specification",
    recorded_by: "u1",
    recorded_at: now,
    classification: "non_phi",
    state: "received",
    ...over,
  });
const brief = (db: SqliteDatabase, id = "br1", over: Record<string, V> = {}) =>
  insert(db, "workshop_brief", {
    id,
    workshop_id: "w1",
    version_no: 1,
    content_json: "{}",
    source: "baseline",
    created_by: "u1",
    created_at: now,
    ...over,
  });
const finding = (db: SqliteDatabase, id = "f1", over: Record<string, V> = {}) =>
  insert(db, "workshop_finding", {
    id,
    workshop_id: "w1",
    version_no: 1,
    kind: "offer_1",
    schema_version: 1,
    content_json: "{}",
    state: "draft",
    lock_no: 1,
    created_by: "u1",
    created_at: now,
    updated_at: now,
    classification: "non_phi",
    ...over,
  });
const output = (db: SqliteDatabase, id = "op1", over: Record<string, V> = {}) =>
  insert(db, "workshop_output_document", {
    id,
    workshop_id: "w1",
    finding_id: "f1",
    revision_no: 1,
    sections_json: "{}",
    state: "draft",
    edited_by: "u1",
    edited_at: now,
    ...over,
  });
const APPROVAL = {
  state: "approved",
  approved_by: "lead",
  approved_at: now,
  pdf_storage_key: "workshop-w1-output-op1.pdf",
  pdf_sha256: "h",
  pdf_pages: 1,
};
const share = (db: SqliteDatabase, id = "s1", over: Record<string, V> = {}) =>
  insert(db, "workshop_output_share", {
    id,
    output_id: "op1",
    how: "handed_over",
    shared_by: "u1",
    shared_at: now,
    ...over,
  });

describe("migrations 0023 and 0024", () => {
  it("apply forward-only and create every table", () => {
    const db = fresh();
    expect(migrate(db)).toEqual([]);
    const names = (
      db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
        name: string;
      }[]
    ).map((t) => t.name);
    for (const t of TABLES) expect(names).toContain(t);
  });

  it("registers every table and column in the column classification", () => {
    const db = fresh();
    for (const t of TABLES) {
      const registered = Object.keys(COLUMN_CLASSIFICATION[t] ?? {});
      const actual = (db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(registered.sort(), t).toEqual(actual.sort());
    }
  });

  it("has no column that could hold a price, credential, contact detail or qualification", () => {
    const db = fresh();
    const banned =
      /price|fee|rate|cost|amount|currency|budget|password|secret|credential|email|phone|qualif|guarantee/i;
    for (const t of TABLES) {
      const cols = (db.raw.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
        (c) => c.name,
      );
      expect(cols.length, t).toBeGreaterThan(0);
      for (const c of cols) expect(c, `${t}.${c}`).not.toMatch(banned);
    }
  });
});

describe("workshop", () => {
  it("accepts the seven states and a length of 15 to 240 minutes", () => {
    const db = fresh();
    fails(() => workshop(db, "w1", { state: "open" }), /CHECK/);
    fails(() => workshop(db, "w1", { duration_minutes: 14 }), /CHECK/);
    fails(() => workshop(db, "w1", { duration_minutes: 241 }), /CHECK/);
    workshop(db);
  });
  it("allows one open workshop per request and a new one after a final state", () => {
    const db = fresh();
    workshop(db);
    fails(() => workshop(db, "w2"), /UNIQUE/);
    update(db, "workshop", "w1", { state: "cancelled", closed_at: later });
    workshop(db, "w2");
  });
  it("has no booking details when requested and all of them once booked", () => {
    const db = fresh();
    fails(() => workshop(db, "w1", { session_date: "2026-12-01" }), /CHECK/);
    fails(() => workshop(db, "w1", { state: "booked" }), /CHECK/);
    workshop(db);
    fails(
      () => update(db, "workshop", "w1", { state: "booked", session_date: "2026-12-01" }),
      /CHECK/,
    );
    update(db, "workshop", "w1", { state: "booked", ...BOOKED });
    fails(() => update(db, "workshop", "w1", { booking_id: null }), /CHECK/);
    fails(() => update(db, "workshop", "w1", { booking_route: "post" }), /CHECK/);
  });
  it("sets closed_at on a final state only", () => {
    const db = fresh();
    workshop(db);
    fails(() => update(db, "workshop", "w1", { closed_at: now }), /CHECK/);
    fails(() => update(db, "workshop", "w1", { state: "cancelled" }), /CHECK/);
    update(db, "workshop", "w1", { state: "cancelled", closed_at: now });
  });
  it.each(["cancelled", "no_show", "closed"])("never changes the final state %s", (state) => {
    const db = fresh();
    workshop(db, "w1", { state, closed_at: now, ...BOOKED });
    fails(() => update(db, "workshop", "w1", { state: "booked", closed_at: null }), /final/);
  });
  it("never changes what it is about and is never deleted", () => {
    const db = fresh();
    workshop(db);
    for (const [column, value] of [
      ["request_id", "q2"],
      ["offer_id", "o2"],
      ["intake_id", "i2"],
      ["account_id", "a2"],
      ["contact_id", "c2"],
      ["created_by", "u2"],
      ["created_at", later],
    ] as const) {
      fails(() => update(db, "workshop", "w1", { [column]: value }), /never changes/);
    }
    fails(remove(db, "workshop", "w1"), /cannot be deleted/);
  });
});

describe("history, participants and effort", () => {
  it("needs a note for cancel, no-show, close and a reschedule, and is append-only", () => {
    const db = fresh();
    workshop(db);
    history(db, "h1");
    for (const to of ["cancelled", "no_show", "closed"]) {
      fails(() => history(db, "h2", { from_state: "booked", to_state: to }), /CHECK/);
    }
    fails(() => history(db, "h2", { from_state: "booked", to_state: "booked" }), /CHECK/);
    fails(() => history(db, "h2", { note: "ab" }), /CHECK/);
    history(db, "h2", { from_state: "requested", to_state: "booked" });
    history(db, "h3", { from_state: "booked", to_state: "booked", note: "moved by the buyer" });
    fails(() => update(db, "workshop_state_history", "h1", { note: "changed" }), /append-only/);
    fails(remove(db, "workshop_state_history", "h1"), /append-only/);
  });
  it("removes a participant once and changes nothing else", () => {
    const db = fresh();
    workshop(db);
    const add = (id: string, over: Record<string, V> = {}) =>
      insert(db, "workshop_participant", {
        id,
        workshop_id: "w1",
        side: "buyer",
        display_name: "Synthetic Person",
        added_by: "u1",
        added_at: now,
        ...over,
      });
    fails(() => add("p1", { side: "observer" }), /CHECK/);
    fails(() => add("p1", { display_name: "x".repeat(121) }), /CHECK/);
    fails(() => add("p1", { role_title: "x".repeat(121) }), /CHECK/);
    add("p1");
    fails(() => update(db, "workshop_participant", "p1", { display_name: "Other" }), /removed/);
    fails(() => update(db, "workshop_participant", "p1", { removed_at: later }), /CHECK|removed/);
    update(db, "workshop_participant", "p1", { removed_at: later, removed_by: "u1" });
    fails(
      () => update(db, "workshop_participant", "p1", { removed_at: now, removed_by: "u2" }),
      /removed once/,
    );
    fails(remove(db, "workshop_participant", "p1"), /cannot be deleted/);
  });
  it("keeps effort within its ranges and append-only", () => {
    const db = fresh();
    workshop(db);
    const effort = (id: string, over: Record<string, V> = {}) =>
      insert(db, "delivery_effort", {
        id,
        workshop_id: "w1",
        prep_hours: 2.5,
        session_hours: 1,
        people: 2,
        recorded_by: "u1",
        recorded_at: now,
        ...over,
      });
    const outOfRange: Record<string, V>[] = [
      { prep_hours: -1 },
      { prep_hours: 80.25 },
      { session_hours: 24.5 },
      { people: 0 },
      { people: 21 },
      { people: 1.5 },
    ];
    for (const bad of outOfRange) {
      fails(() => effort("e1", bad), /CHECK/);
    }
    effort("e1");
    fails(() => update(db, "delivery_effort", "e1", { people: 3 }), /append-only/);
    fails(remove(db, "delivery_effort", "e1"), /append-only/);
  });
});

describe("workshop_artifact", () => {
  const ready = () => {
    const db = fresh();
    workshop(db);
    return db;
  };
  const held = { state: "held", reference: null, quarantine_item_id: "qi1" };

  it("checks lengths, classification and state", () => {
    const db = ready();
    fails(() => artifact(db, "ar1", { title: "x".repeat(201) }), /CHECK/);
    fails(() => artifact(db, "ar1", { reference: "x".repeat(501) }), /CHECK/);
    fails(() => artifact(db, "ar1", { supplied_by_label: "x".repeat(121) }), /CHECK/);
    fails(() => artifact(db, "ar1", { classification: "phi" }), /CHECK/);
    fails(() => artifact(db, "ar1", { state: "pending" }), /CHECK/);
  });
  it("needs a reference or a stored file when received or released, but not when held", () => {
    const db = ready();
    fails(() => artifact(db, "ar1", { reference: null }), /CHECK/);
    artifact(db, "ar1", held);
    artifact(db, "ar2", { reference: null, storage_key: "workshop-w1-specification-ar2.txt" });
    fails(
      () => artifact(db, "ar3", { ...held, storage_key: "workshop-w1-specification-ar3.txt" }),
      /CHECK/,
    );
    fails(() => artifact(db, "ar3", { ...held, content_sha256: "h" }), /CHECK/);
  });
  it("moves only from held, to released or discarded", () => {
    const db = ready();
    artifact(db, "ar1", held);
    artifact(db, "ar2", held);
    artifact(db, "ar3");
    fails(() => update(db, "workshop_artifact", "ar1", { state: "released" }), /CHECK/);
    update(db, "workshop_artifact", "ar1", {
      state: "released",
      storage_key: "workshop-w1-specification-ar1.txt",
      size_bytes: 10,
      content_sha256: "h",
      decided_by: "reviewer",
      decided_at: now,
    });
    update(db, "workshop_artifact", "ar2", { state: "discarded" });
    for (const [id, state] of [
      ["ar1", "discarded"],
      ["ar2", "released"],
      ["ar3", "held"],
      ["ar3", "discarded"],
    ] as const) {
      fails(() => update(db, "workshop_artifact", id, { state }), /invalid artifact state|CHECK/);
    }
  });
  it("changes only its decision and file columns, sets deletion once and is never deleted", () => {
    const db = ready();
    artifact(db);
    const fixed: Record<string, V>[] = [
      { title: "Other" },
      { reference: "Other" },
      { kind: "timeline" },
      { recorded_by: "u2" },
      { hold_rule_ids_json: '["PHI.SSN"]' },
    ];
    for (const change of fixed) {
      fails(() => update(db, "workshop_artifact", "ar1", change), /only its decision/);
    }
    update(db, "workshop_artifact", "ar1", { file_deleted_at: now });
    fails(() => update(db, "workshop_artifact", "ar1", { file_deleted_at: later }), /deleted once/);
    fails(remove(db, "workshop_artifact", "ar1"), /cannot be deleted/);
  });
});

describe("workshop_brief", () => {
  it("is append-only apart from one review", () => {
    const db = fresh();
    workshop(db);
    fails(() => brief(db, "br1", { source: "human" }), /CHECK/);
    fails(() => brief(db, "br1", { confidence: "certain" }), /CHECK/);
    fails(() => brief(db, "br1", { rationale: "x".repeat(301) }), /CHECK/);
    fails(() => brief(db, "br1", { ai_invocation_id: "x" }), /CHECK|FOREIGN/);
    fails(() => brief(db, "br1", { review_status: "reviewed" }), /CHECK/);
    brief(db);
    fails(() => brief(db, "br2"), /UNIQUE/);
    fails(() => update(db, "workshop_brief", "br1", { content_json: '{"a":1}' }), /append-only/);
    fails(() => update(db, "workshop_brief", "br1", { review_status: "reviewed" }), /CHECK|once/);
    update(db, "workshop_brief", "br1", {
      review_status: "reviewed",
      reviewed_by: "u2",
      reviewed_at: now,
    });
    fails(
      () => update(db, "workshop_brief", "br1", { reviewed_by: "u3", reviewed_at: later }),
      /reviewed once/,
    );
    fails(remove(db, "workshop_brief", "br1"), /append-only/);
  });
});

describe("workshop_finding", () => {
  const ready = () => {
    const db = fresh();
    workshop(db);
    return db;
  };
  it("allows one draft per workshop and needs a reason for a correction", () => {
    const db = ready();
    fails(() => finding(db, "f1", { kind: "offer_5" }), /CHECK/);
    fails(() => finding(db, "f1", { classification: "phi" }), /CHECK/);
    finding(db);
    fails(() => finding(db, "f2", { version_no: 2, correction_reason: "a fix" }), /UNIQUE/);
    update(db, "workshop_finding", "f1", {
      state: "finalised",
      finalised_by: "u1",
      finalised_at: now,
    });
    fails(() => finding(db, "f2", { version_no: 2 }), /CHECK/);
    fails(() => finding(db, "f2", { version_no: 2, correction_reason: "ab" }), /CHECK/);
    finding(db, "f2", { version_no: 2, correction_reason: "a fix" });
  });
  it("needs a waiver of at least ten characters and who finalised it", () => {
    const db = ready();
    fails(() => finding(db, "f1", { waiver_reason: "too short" }), /CHECK/);
    finding(db);
    fails(() => update(db, "workshop_finding", "f1", { state: "finalised" }), /CHECK/);
    fails(() => update(db, "workshop_finding", "f1", { finalised_by: "u1" }), /CHECK/);
  });
  it("edits a draft but fixes every column once finalised", () => {
    const db = ready();
    finding(db);
    update(db, "workshop_finding", "f1", { content_json: '{"a":1}', lock_no: 2 });
    fails(() => update(db, "workshop_finding", "f1", { kind: "offer_6" }), /never changes/);
    update(db, "workshop_finding", "f1", {
      state: "finalised",
      finalised_by: "u1",
      finalised_at: now,
    });
    const frozen: Record<string, V>[] = [
      { content_json: "{}" },
      { waiver_reason: "a reason that is long enough" },
      { lock_no: 3 },
      { updated_at: later },
    ];
    for (const change of frozen) {
      fails(() => update(db, "workshop_finding", "f1", change), /finalised/);
    }
    fails(remove(db, "workshop_finding", "f1"), /cannot be deleted/);
  });
});

describe("workshop outputs and sharing", () => {
  const ready = () => {
    const db = fresh();
    workshop(db);
    finding(db);
    return db;
  };
  it("needs a one-page PDF to be approved", () => {
    const db = ready();
    fails(() => output(db, "op1", { state: "approved" }), /CHECK/);
    output(db);
    fails(() => update(db, "workshop_output_document", "op1", { ...APPROVAL, pdf_pages: 2 }));
    fails(() =>
      update(db, "workshop_output_document", "op1", { ...APPROVAL, pdf_storage_key: null }),
    );
    fails(() => update(db, "workshop_output_document", "op1", { approved_by: "lead" }));
    update(db, "workshop_output_document", "op1", APPROVAL);
  });
  it("never edits a revision, approves once and fixes the row except the file deletion", () => {
    const db = ready();
    output(db);
    fails(
      () => update(db, "workshop_output_document", "op1", { sections_json: '{"a":1}' }),
      /revision never changes/,
    );
    fails(
      () => update(db, "workshop_output_document", "op1", { file_deleted_at: now }),
      /deleted once/,
    );
    update(db, "workshop_output_document", "op1", APPROVAL);
    const afterApproval: Record<string, V>[] = [
      { approved_by: "other" },
      { state: "draft" },
      { pdf_sha256: "x" },
    ];
    for (const change of afterApproval) {
      fails(() => update(db, "workshop_output_document", "op1", change));
    }
    update(db, "workshop_output_document", "op1", { file_deleted_at: now });
    fails(
      () => update(db, "workshop_output_document", "op1", { file_deleted_at: later }),
      /deleted once/,
    );
    fails(remove(db, "workshop_output_document", "op1"), /cannot be deleted/);
  });
  it("shares only an approved output and keeps the record", () => {
    const db = ready();
    output(db);
    fails(() => share(db), /approved/);
    update(db, "workshop_output_document", "op1", APPROVAL);
    fails(() => share(db, "s1", { how: "emailed" }), /CHECK/);
    fails(() => share(db, "s1", { note: "x".repeat(301) }), /CHECK/);
    share(db);
    fails(() => update(db, "workshop_output_share", "s1", { how: "other" }), /append-only/);
    fails(remove(db, "workshop_output_share", "s1"), /append-only/);
  });
});
