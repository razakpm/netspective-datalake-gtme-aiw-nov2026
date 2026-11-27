import type { SqliteDatabase } from "@gtm/db";
import { FIELD_NAMES } from "./workshops-harness.js";

// A linked intake request inserted directly, for the HTTP tests that run on the identity fixture
// (feature 007). The public form that normally makes one has its own tests. Synthetic only.

let sequence = 0;

export interface SeededIntake {
  requestId: string;
  accountId: string;
  contactId: string;
  offerId: string;
}

export function seedLinkedIntake(
  db: SqliteDatabase,
  offer: 1 | 6 = 1,
  fieldNames: string[] = FIELD_NAMES,
): SeededIntake {
  const n = ++sequence;
  const ids = {
    requestId: `workshop-request-${n}`,
    accountId: `workshop-account-${n}`,
    contactId: `workshop-contact-${n}`,
    offerId: `offer-${offer}`,
  };
  const at = new Date().toISOString();
  const run = (sql: string, ...args: (string | number | null)[]) =>
    db.raw.prepare(sql).run(...args);
  run(
    "INSERT INTO account (id, name, name_normalised, created_at, updated_at) VALUES (?,?,?,?,?)",
    ids.accountId,
    `Synthetic Exchange ${n}`,
    `synthetic exchange ${n}`,
    at,
    at,
  );
  run("INSERT INTO contact (id, created_at, updated_at) VALUES (?,?,?)", ids.contactId, at, at);
  run(
    "INSERT INTO account_contact_relationship (id, account_id, contact_id, started_at) VALUES (?,?,?,?)",
    `workshop-relationship-${n}`,
    ids.accountId,
    ids.contactId,
    at,
  );
  const slug = offer === 1 ? "sender-onboarding-friction-map" : "pilot-input-trace-workshop";
  run(
    "INSERT INTO offer_request (id, offer_id, form_slug, kind, state, email_hash, account_id, contact_id, submitted_at) VALUES (?,?,?,'intake','linked',?,?,?,?)",
    ids.requestId,
    ids.offerId,
    slug,
    `hash-${n}`,
    ids.accountId,
    ids.contactId,
    at,
  );
  const payload =
    offer === 1
      ? { organisationName: `Synthetic Exchange ${n}`, attendingRoles: ["Integration lead"] }
      : { useCase: "Readmission risk pilot", fieldNames };
  run(
    "INSERT INTO intake_submission (id, request_id, offer_id, kind, schema_version, account_id, contact_id, payload_json, classification, submitted_at) VALUES (?,?,?,?,1,?,?,?, 'non_phi', ?)",
    `workshop-intake-${n}`,
    ids.requestId,
    ids.offerId,
    offer === 1 ? "offer_1" : "offer_6",
    ids.accountId,
    ids.contactId,
    JSON.stringify(payload),
    at,
  );
  return ids;
}
