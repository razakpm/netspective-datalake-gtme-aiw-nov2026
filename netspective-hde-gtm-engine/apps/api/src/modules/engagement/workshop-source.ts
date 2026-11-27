import type { Tx } from "@gtm/db";
import type { RequestKind } from "./public-forms.js";

// Read-only view of a request for the workshops module (feature 007, research R-01). No permission check
// here: the caller checks. Only what a workshop is made from: no email, name or consent text.

export interface WorkshopRequestSource {
  state: "received" | "reviewed" | "linked" | "closed";
  kind: RequestKind;
  offerId: string;
  accountId: string | null;
  contactId: string | null;
  intake: { id: string; kind: "offer_1" | "offer_6"; payload: unknown } | null;
}

export function loadRequestForWorkshop(tx: Tx, requestId: string): WorkshopRequestSource | null {
  const r = tx
    .prepare("SELECT state, kind, offer_id, account_id, contact_id FROM offer_request WHERE id = ?")
    .get(requestId) as
    | {
        state: WorkshopRequestSource["state"];
        kind: RequestKind;
        offer_id: string;
        account_id: string | null;
        contact_id: string | null;
      }
    | undefined;
  if (!r) return null;
  const intake = tx
    .prepare("SELECT id, kind, payload_json FROM intake_submission WHERE request_id = ?")
    .get(requestId) as
    { id: string; kind: "offer_1" | "offer_6"; payload_json: string } | undefined;
  return {
    state: r.state,
    kind: r.kind,
    offerId: r.offer_id,
    accountId: r.account_id,
    contactId: r.contact_id,
    intake: intake
      ? { id: intake.id, kind: intake.kind, payload: JSON.parse(intake.payload_json) as unknown }
      : null,
  };
}
