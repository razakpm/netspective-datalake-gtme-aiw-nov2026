import type { Tx } from "@gtm/db";
import type { OfferStatus } from "@gtm/domain";
import { latestStatus, getHead, getVersionRow, type VersionRow } from "./repository.js";
import { parseSnapshot } from "./queries.js";

// What the workshops module needs to know about an offer (feature 007, research R-01). Read only, no
// permission check: the caller checks.

export interface OfferFacts {
  id: string;
  key: string;
  name: string | null;
  /** The in-force version's status, or the latest version's when none is in force. */
  status: OfferStatus;
  /** The recorded effort estimate, a hypothesis. */
  effortEstimate: string | null;
}

export function offerFacts(tx: Tx, offerId: string): OfferFacts | null {
  const head = getHead(tx, offerId);
  if (!head) return null;
  const versionNo = head.inForceVersionNo ?? head.latestVersionNo;
  const snapshot = parseSnapshot(getVersionRow(tx, offerId, versionNo) as VersionRow);
  return {
    id: head.id,
    key: head.key,
    name: snapshot.name,
    status: latestStatus(tx, offerId, versionNo).status,
    effortEstimate: snapshot.effortEstimate.text,
  };
}
