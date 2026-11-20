import type { Tx } from "@gtm/db";
import type { OfferStatus } from "@gtm/domain";

// Persistence for offers, versions, statuses and limitations (feature 005). SQL only.

type Row = Record<string, unknown>;

export interface OfferHead {
  id: string;
  number: number;
  key: string;
  latestVersionNo: number;
  inForceVersionNo: number | null;
  lockNo: number;
  createdAt: string;
}
export interface VersionRow {
  offerId: string;
  versionNo: number;
  snapshotJson: string;
  snapshotHash: string;
  reason: string;
  createdBy: string;
  createdAt: string;
}
export interface StatusRow {
  status: OfferStatus;
  changedBy: string;
  note: string | null;
  changedAt: string;
}
export interface LimitationRow {
  id: string;
  offerId: string;
  key: string;
  wording: string;
  active: boolean;
}
export interface AckRow {
  id: string;
  limitationId: string;
  wordingHash: string;
  acknowledgedBy: string;
  acknowledgedAt: string;
}

const head = (r: Row): OfferHead => ({
  id: r["id"] as string,
  number: r["number"] as number,
  key: r["key"] as string,
  latestVersionNo: r["latest_version_no"] as number,
  inForceVersionNo: r["in_force_version_no"] as number | null,
  lockNo: r["lock_no"] as number,
  createdAt: r["created_at"] as string,
});
const version = (r: Row): VersionRow => ({
  offerId: r["offer_id"] as string,
  versionNo: r["version_no"] as number,
  snapshotJson: r["snapshot_json"] as string,
  snapshotHash: r["snapshot_hash"] as string,
  reason: r["reason"] as string,
  createdBy: r["created_by"] as string,
  createdAt: r["created_at"] as string,
});
const limitation = (r: Row): LimitationRow => ({
  id: r["id"] as string,
  offerId: r["offer_id"] as string,
  key: r["key"] as string,
  wording: r["wording"] as string,
  active: r["active"] === 1,
});

export const listHeads = (tx: Tx): OfferHead[] =>
  (tx.prepare("SELECT * FROM engagement_offer ORDER BY number").all() as Row[]).map(head);

export function getHead(tx: Tx, id: string): OfferHead | null {
  const row = tx.prepare("SELECT * FROM engagement_offer WHERE id = ?").get(id) as Row | undefined;
  return row ? head(row) : null;
}

export function getVersionRow(tx: Tx, offerId: string, versionNo: number): VersionRow | null {
  const row = tx
    .prepare("SELECT * FROM offer_version WHERE offer_id = ? AND version_no = ?")
    .get(offerId, versionNo) as Row | undefined;
  return row ? version(row) : null;
}

export const listVersionRows = (tx: Tx, offerId: string): VersionRow[] =>
  (
    tx
      .prepare("SELECT * FROM offer_version WHERE offer_id = ? ORDER BY version_no")
      .all(offerId) as Row[]
  ).map(version);

export function insertVersion(tx: Tx, v: VersionRow): void {
  tx.prepare(
    "INSERT INTO offer_version (offer_id, version_no, snapshot_json, snapshot_hash, reason, created_by, created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(v.offerId, v.versionNo, v.snapshotJson, v.snapshotHash, v.reason, v.createdBy, v.createdAt);
}

export function insertStatus(
  tx: Tx,
  s: { id: string; offerId: string; versionNo: number } & StatusRow,
): void {
  tx.prepare(
    "INSERT INTO offer_version_status (id, offer_id, version_no, status, changed_by, note, changed_at) VALUES (?,?,?,?,?,?,?)",
  ).run(s.id, s.offerId, s.versionNo, s.status, s.changedBy, s.note, s.changedAt);
}

/** A version's status is its latest row. */
export function latestStatus(tx: Tx, offerId: string, versionNo: number): StatusRow {
  const row = tx
    .prepare(
      "SELECT status, changed_by, note, changed_at FROM offer_version_status WHERE offer_id = ? AND version_no = ? ORDER BY changed_at DESC, rowid DESC LIMIT 1",
    )
    .get(offerId, versionNo) as Row | undefined;
  if (!row) throw new Error(`offer ${offerId} version ${versionNo} has no status`);
  return {
    status: row["status"] as OfferStatus,
    changedBy: row["changed_by"] as string,
    note: row["note"] as string | null,
    changedAt: row["changed_at"] as string,
  };
}

/** The statuses a version has been through, oldest first. */
export const statusHistory = (tx: Tx, offerId: string, versionNo: number): StatusRow[] =>
  (
    tx
      .prepare(
        "SELECT status, changed_by, note, changed_at FROM offer_version_status WHERE offer_id = ? AND version_no = ? ORDER BY changed_at, rowid",
      )
      .all(offerId, versionNo) as Row[]
  ).map((r) => ({
    status: r["status"] as OfferStatus,
    changedBy: r["changed_by"] as string,
    note: r["note"] as string | null,
    changedAt: r["changed_at"] as string,
  }));

/** True when a later version has ever been approved: then this one is superseded (derived, not stored). */
export function isSuperseded(tx: Tx, offerId: string, versionNo: number): boolean {
  return (
    tx
      .prepare(
        "SELECT 1 FROM offer_version_status WHERE offer_id = ? AND version_no > ? AND status = 'approved' LIMIT 1",
      )
      .get(offerId, versionNo) !== undefined
  );
}

/** Optimistic head update used when a version is created. */
export function bumpHead(
  tx: Tx,
  offerId: string,
  expectedLock: number,
  latestVersionNo: number,
): boolean {
  const res = tx
    .prepare(
      "UPDATE engagement_offer SET latest_version_no = ?, lock_no = lock_no + 1 WHERE id = ? AND lock_no = ?",
    )
    .run(latestVersionNo, offerId, expectedLock);
  return Number(res.changes) === 1;
}

export function setInForce(tx: Tx, offerId: string, versionNo: number | null): void {
  tx.prepare(
    "UPDATE engagement_offer SET in_force_version_no = ?, lock_no = lock_no + 1 WHERE id = ?",
  ).run(versionNo, offerId);
}

export const listLimitations = (tx: Tx, offerId: string): LimitationRow[] =>
  (
    tx
      .prepare("SELECT * FROM offer_limitation WHERE offer_id = ? ORDER BY key")
      .all(offerId) as Row[]
  ).map(limitation);

export function getLimitation(tx: Tx, id: string): LimitationRow | null {
  const row = tx.prepare("SELECT * FROM offer_limitation WHERE id = ?").get(id) as Row | undefined;
  return row ? limitation(row) : null;
}

export function insertLimitation(tx: Tx, l: LimitationRow): void {
  tx.prepare(
    "INSERT INTO offer_limitation (id, offer_id, key, wording, active) VALUES (?,?,?,?,?)",
  ).run(l.id, l.offerId, l.key, l.wording, l.active ? 1 : 0);
}

export function updateLimitationWording(tx: Tx, id: string, wording: string): void {
  tx.prepare("UPDATE offer_limitation SET wording = ? WHERE id = ?").run(wording, id);
}

export function insertAck(tx: Tx, a: AckRow): void {
  tx.prepare(
    "INSERT INTO offer_limitation_ack (id, limitation_id, wording_hash, acknowledged_by, acknowledged_at) VALUES (?,?,?,?,?)",
  ).run(a.id, a.limitationId, a.wordingHash, a.acknowledgedBy, a.acknowledgedAt);
}

export function latestAck(tx: Tx, limitationId: string): AckRow | null {
  const row = tx
    .prepare(
      "SELECT * FROM offer_limitation_ack WHERE limitation_id = ? ORDER BY acknowledged_at DESC, rowid DESC LIMIT 1",
    )
    .get(limitationId) as Row | undefined;
  return row
    ? {
        id: row["id"] as string,
        limitationId: row["limitation_id"] as string,
        wordingHash: row["wording_hash"] as string,
        acknowledgedBy: row["acknowledged_by"] as string,
        acknowledgedAt: row["acknowledged_at"] as string,
      }
    : null;
}

// Capacity limits and bookings (feature 005, tasks T040 and T041).

export interface CapacityRow {
  id: string;
  offerId: string;
  periodKind: "week" | "month";
  limitSessions: number;
  effectiveFrom: string;
  setBy: string;
  setAt: string;
  reason: string | null;
}
export interface BookingRow {
  id: string;
  offerId: string;
  externalRef: string | null;
  state: "booked" | "held" | "cancelled" | "no_show";
  sessionDate: string;
  periodStart: string;
  source: "manual" | "workshop";
  recordedBy: string;
  recordedAt: string;
  updatedAt: string;
}

const capacity = (r: Row): CapacityRow => ({
  id: r["id"] as string,
  offerId: r["offer_id"] as string,
  periodKind: r["period_kind"] as "week" | "month",
  limitSessions: r["limit_sessions"] as number,
  effectiveFrom: r["effective_from"] as string,
  setBy: r["set_by"] as string,
  setAt: r["set_at"] as string,
  reason: r["reason"] as string | null,
});
const booking = (r: Row): BookingRow => ({
  id: r["id"] as string,
  offerId: r["offer_id"] as string,
  externalRef: r["external_ref"] as string | null,
  state: r["state"] as BookingRow["state"],
  sessionDate: r["session_date"] as string,
  periodStart: r["period_start"] as string,
  source: r["source"] as BookingRow["source"],
  recordedBy: r["recorded_by"] as string,
  recordedAt: r["recorded_at"] as string,
  updatedAt: r["updated_at"] as string,
});

export const listCapacity = (tx: Tx, offerId: string): CapacityRow[] =>
  (
    tx
      .prepare("SELECT * FROM offer_capacity WHERE offer_id = ? ORDER BY set_at, rowid")
      .all(offerId) as Row[]
  ).map(capacity);

export function insertCapacity(tx: Tx, c: CapacityRow): void {
  tx.prepare(
    "INSERT INTO offer_capacity (id, offer_id, period_kind, limit_sessions, effective_from, set_by, set_at, reason) VALUES (?,?,?,?,?,?,?,?)",
  ).run(
    c.id,
    c.offerId,
    c.periodKind,
    c.limitSessions,
    c.effectiveFrom,
    c.setBy,
    c.setAt,
    c.reason,
  );
}

export const listBookings = (tx: Tx, offerId: string): BookingRow[] =>
  (
    tx
      .prepare(
        "SELECT * FROM offer_session_booking WHERE offer_id = ? ORDER BY session_date, rowid",
      )
      .all(offerId) as Row[]
  ).map(booking);

export function getBooking(tx: Tx, id: string): BookingRow | null {
  const row = tx.prepare("SELECT * FROM offer_session_booking WHERE id = ?").get(id) as
    Row | undefined;
  return row ? booking(row) : null;
}

export function insertBooking(tx: Tx, b: BookingRow): void {
  tx.prepare(
    "INSERT INTO offer_session_booking (id, offer_id, external_ref, state, session_date, period_start, source, recorded_by, recorded_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    b.id,
    b.offerId,
    b.externalRef,
    b.state,
    b.sessionDate,
    b.periodStart,
    b.source,
    b.recordedBy,
    b.recordedAt,
    b.updatedAt,
  );
}

export function updateBooking(
  tx: Tx,
  id: string,
  patch: { state?: BookingRow["state"]; sessionDate?: string; periodStart?: string },
  at: string,
): void {
  const current = getBooking(tx, id) as BookingRow;
  tx.prepare(
    "UPDATE offer_session_booking SET state = ?, session_date = ?, period_start = ?, updated_at = ? WHERE id = ?",
  ).run(
    patch.state ?? current.state,
    patch.sessionDate ?? current.sessionDate,
    patch.periodStart ?? current.periodStart,
    at,
    id,
  );
}
