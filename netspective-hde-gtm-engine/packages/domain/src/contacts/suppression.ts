import { createHmac } from "node:crypto";

// Suppression primitives and the single eligibility check (feature 002 FR-044 slice, built in feature 006,
// research R-02). Pure. A person is suppressed when the latest record for their contact, their account or
// their keyed email hash says so; an erasure marker always suppresses. Hashes are keyed so a leaked table
// does not give away addresses.

export const canonicalEmail = (email: string): string => email.trim().toLowerCase();

export function keyedEmailHash(email: string, key: string): string {
  return createHmac("sha256", key).update(canonicalEmail(email)).digest("hex");
}

export interface SuppressionRecordLike {
  id: string;
  scope: "contact" | "account";
  contactId: string | null;
  accountId: string | null;
  emailHash: string | null;
  action: "add" | "lift" | "erase_marker";
  recordedAt: string;
}

export interface SuppressionSubject {
  contactId: string | null;
  accountId: string | null;
  emailHash: string | null;
}

export type SuppressionStatus =
  { suppressed: false } | { suppressed: true; scope: "contact" | "email_hash" | "account" };

const later = (a: SuppressionRecordLike, b: SuppressionRecordLike) =>
  a.recordedAt > b.recordedAt || (a.recordedAt === b.recordedAt && a.id > b.id) ? a : b;

function latest(records: readonly SuppressionRecordLike[]): SuppressionRecordLike | undefined {
  return records.reduce<SuppressionRecordLike | undefined>(
    (best, r) => (best === undefined ? r : later(best, r)),
    undefined,
  );
}

const holds = (r: SuppressionRecordLike | undefined) =>
  r !== undefined && (r.action === "add" || r.action === "erase_marker");

export function suppressionStatus(
  who: SuppressionSubject,
  records: readonly SuppressionRecordLike[],
): SuppressionStatus {
  const byContact = who.contactId
    ? records.filter((r) => r.scope === "contact" && r.contactId === who.contactId)
    : [];
  if (holds(latest(byContact))) return { suppressed: true, scope: "contact" };

  const byHash = who.emailHash
    ? records.filter(
        (r) => r.scope === "contact" && r.contactId === null && r.emailHash === who.emailHash,
      )
    : [];
  if (holds(latest(byHash))) return { suppressed: true, scope: "email_hash" };

  const byAccount = who.accountId
    ? records.filter((r) => r.scope === "account" && r.accountId === who.accountId)
    : [];
  if (holds(latest(byAccount))) return { suppressed: true, scope: "account" };

  return { suppressed: false };
}
