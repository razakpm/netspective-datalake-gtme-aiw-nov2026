import { createHash } from "node:crypto";
import type { Tx } from "@gtm/db";
import {
  missingRequiredFields,
  OfferSnapshotSchema,
  PUBLIC_OFFER_FIELDS,
  type OfferSnapshot,
  type OfferStatus,
} from "@gtm/domain";
import { coverReport } from "../claims/index.js";
import {
  getVersionRow,
  isSuperseded,
  latestAck,
  latestStatus,
  listLimitations,
  statusHistory,
  type LimitationRow,
  type OfferHead,
  type VersionRow,
} from "./repository.js";

// Read models of the offers module: versions with their status, limitations with their acknowledgement
// state, and the offer summary. Statuses, superseded and stale flags are derived here, never stored.

export const wordingHash = (wording: string): string =>
  createHash("sha256").update(wording).digest("hex");

export interface VersionView {
  offerId: string;
  versionNo: number;
  snapshot: OfferSnapshot;
  snapshotHash: string;
  reason: string;
  createdBy: string;
  createdAt: string;
  status: OfferStatus;
  statusChangedBy: string;
  statusChangedAt: string;
  superseded: boolean;
  /** Every status the version has been through, oldest first. */
  history: { status: OfferStatus; changedBy: string; note: string | null; changedAt: string }[];
}

export interface LimitationView {
  id: string;
  offerId: string;
  key: string;
  wording: string;
  active: boolean;
  /** A valid acknowledgement exists: its wording hash equals the current wording's hash. */
  acknowledged: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  /** The wording changed after the last acknowledgement. */
  acknowledgementStale: boolean;
}

/** Read-time check of the in-force version's public text against the claims as they are now (FR-008). */
export interface ClaimCover {
  /** lapsed: a restricted phrase in public text is no longer covered by an approved, valid claim. */
  status: "ok" | "lapsed";
  claimIds: string[];
  ruleIds: string[];
}

export interface OfferSummary {
  id: string;
  number: number;
  key: string;
  name: string | null;
  lockNo: number;
  /** The in-force version's status, or the latest version's when none is in force. */
  status: OfferStatus;
  inForceVersionNo: number | null;
  latestVersionNo: number;
  latestStatus: OfferStatus;
  /** Approved once by the seed while required attributes are still to be provided. */
  baselineIncomplete: boolean;
  acknowledgementStale: boolean;
  claimCover: ClaimCover;
}

export const parseSnapshot = (row: VersionRow): OfferSnapshot =>
  OfferSnapshotSchema.parse(JSON.parse(row.snapshotJson));

export function versionView(tx: Tx, row: VersionRow): VersionView {
  const status = latestStatus(tx, row.offerId, row.versionNo);
  return {
    offerId: row.offerId,
    versionNo: row.versionNo,
    snapshot: parseSnapshot(row),
    snapshotHash: row.snapshotHash,
    reason: row.reason,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    status: status.status,
    statusChangedBy: status.changedBy,
    statusChangedAt: status.changedAt,
    superseded: isSuperseded(tx, row.offerId, row.versionNo),
    history: statusHistory(tx, row.offerId, row.versionNo),
  };
}

export function limitationView(tx: Tx, l: LimitationRow): LimitationView {
  const ack = latestAck(tx, l.id);
  const valid = ack !== null && ack.wordingHash === wordingHash(l.wording);
  return {
    id: l.id,
    offerId: l.offerId,
    key: l.key,
    wording: l.wording,
    active: l.active,
    acknowledged: valid,
    acknowledgedBy: valid ? ack.acknowledgedBy : null,
    acknowledgedAt: valid ? ack.acknowledgedAt : null,
    acknowledgementStale: ack !== null && !valid,
  };
}

export const limitationViews = (tx: Tx, offerId: string): LimitationView[] =>
  listLimitations(tx, offerId).map((l) => limitationView(tx, l));

export function claimCoverOf(tx: Tx, snapshot: OfferSnapshot | null, at: string): ClaimCover {
  if (snapshot === null) return { status: "ok", claimIds: [], ruleIds: [] };
  const ids = new Set<string>();
  const rules = new Set<string>();
  let lapsed = false;
  for (const field of PUBLIC_OFFER_FIELDS) {
    const text = snapshot[field];
    if (!text) continue;
    const report = coverReport(tx, text, at);
    for (const e of report.uncovered) {
      lapsed = true;
      rules.add(e.rule);
      e.claimIds.forEach((id) => ids.add(id));
    }
    if (!lapsed) report.covered.forEach((e) => e.claimIds.forEach((id) => ids.add(id)));
  }
  return lapsed
    ? { status: "lapsed", claimIds: [...ids].sort(), ruleIds: [...rules].sort() }
    : { status: "ok", claimIds: [...ids].sort(), ruleIds: [] };
}

export function offerSummary(tx: Tx, head: OfferHead, at: string): OfferSummary {
  const latestRow = getVersionRow(tx, head.id, head.latestVersionNo) as VersionRow;
  const latest = latestStatus(tx, head.id, head.latestVersionNo);
  const inForceRow =
    head.inForceVersionNo === null ? null : getVersionRow(tx, head.id, head.inForceVersionNo);
  const inForce = inForceRow ? latestStatus(tx, head.id, inForceRow.versionNo) : null;
  const shown = inForceRow ?? latestRow;
  const approvedBySeed =
    inForceRow !== null &&
    statusHistory(tx, head.id, inForceRow.versionNo).some(
      (s) => s.status === "approved" && s.changedBy === "seed",
    );
  return {
    id: head.id,
    number: head.number,
    key: head.key,
    name: parseSnapshot(shown).name,
    lockNo: head.lockNo,
    status: (inForce ?? latest).status,
    inForceVersionNo: head.inForceVersionNo,
    latestVersionNo: head.latestVersionNo,
    latestStatus: latest.status,
    baselineIncomplete:
      approvedBySeed &&
      inForceRow !== null &&
      missingRequiredFields(parseSnapshot(inForceRow)).length > 0,
    acknowledgementStale: limitationViews(tx, head.id).some(
      (l) => l.active && l.acknowledgementStale,
    ),
    claimCover: claimCoverOf(tx, inForceRow ? parseSnapshot(inForceRow) : null, at),
  };
}
