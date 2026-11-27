// Browser-side HTTP helper for the offers, capabilities and claims screens (feature 005). A refusal carries
// stable codes from the API; a screen shows the plain message for the code, never the server's own text.

export class CatalogueApiError extends Error {
  constructor(
    readonly status: number,
    readonly codes: string[] = [],
  ) {
    super(`request failed (${status})`);
    this.name = "CatalogueApiError";
  }
}

const REASONS: Record<string, string> = {
  stale_version: "Someone else changed this. Reload and try again.",
  no_changes: "Nothing was changed.",
  invalid_transition: "That status move is not allowed from the current status.",
  version_superseded:
    "A later version has been approved, so this version can no longer change status.",
  placeholder_attributes: "Some details are still to be provided. Fill them in before approving.",
  limitation_unacknowledged:
    "A limitation has not been acknowledged yet. A service lead must acknowledge it first.",
  uncovered_restricted_phrase:
    "The public text uses restricted wording that no approved claim covers.",
  capacity_exhausted:
    "This offer is full for that period. Choose another period or raise the limit.",
  duplicate_booking: "A booking with that reference already exists for this offer.",
  invalid_booking_state: "Only a booked session can be changed.",
  booking_owned_by_workshop: "This booking belongs to a workshop. Change it from the workshop.",
  claim_needs_evidence: "Link valid evidence before approving. Omit the statement until then.",
  drafter_cannot_approve: "The person who drafted a claim cannot review it.",
  already_reviewed: "You have already reviewed this claim.",
  rejected: "This claim was rejected. Draft a new claim.",
  claim_closed: "This claim is already decided or withdrawn.",
  already_withdrawn: "That evidence is already withdrawn.",
  no_such_flag: "That rule does not flag this sentence.",
  reviewer_is_author: "A reviewer other than the author must be named.",
  reviewer_not_designated: "The reviewer must be a designated approver.",
  no_evidence_basis: "Record an evidence basis before approving this capability for public claims.",
  claim_not_approved: "An approved claim with valid evidence is required.",
  unknown_paid_type: "That paid engagement type does not exist.",
  invalid_weeks: "The minimum weeks cannot be greater than the maximum weeks.",
  score_out_of_range: "That score is outside the allowed scale.",
  already_decided: "That deliverable has already been decided.",
  limitation_exists: "A limitation with that key already exists.",
  criterion_exists: "A criterion with that key already exists.",
  contact_suppressed: "This contact or account is suppressed, so nothing can go to them.",
  no_communication_permission: "There is no permission to contact this person.",
  account_excluded: "This organisation is outside the ICP, so no offer is recommended.",
  fit_not_priority: "ICP fit is not strong enough for outreach yet.",
  offer_unavailable: "That offer is not available right now.",
  already_waiting: "This account is already on the wait-list for that offer.",
  already_closed: "That entry has already been closed.",
  request_closed: "That request has already been linked or closed.",
  business_email_required: "Give a business email address to link this request to a contact.",
  personal_email_not_business: "Give a business email address, not a personal one.",
  author_cannot_approve: "The author of a notice version cannot approve it.",
  already_approved: "That version is already approved.",
  rules_tests_failed: "The rule tests fail, so this rule set cannot be activated.",
  rules_invalid: "The rule set is not valid.",
  not_a_draft: "Only a draft can be activated.",
  // Feature 007 (workshop operations).
  request_not_linked: "Review the request and link it to an account and contact first.",
  offer_not_supported: "Only an Offer 1 or Offer 6 intake can become a workshop.",
  workshop_open: "This request already has an open workshop.",
  note_required: "Give a reason of at least three characters.",
  time_required: "Choose a date and time.",
  calendar_failed:
    "The calendar did not accept that time. Nothing was booked; you can book by hand.",
  contact_detail_not_accepted:
    "Give a name and a role only. Email addresses and phone numbers belong on a contact.",
  contact_not_at_account: "That contact does not belong to this account.",
  already_removed: "That participant has already been removed.",
  artifact_kind_not_allowed: "That kind of artifact is not accepted.",
  reference_or_content_required: "Give a reference or choose a text file.",
  binary_not_accepted:
    "Only text files can be kept, because nothing else can be checked. Record a reference instead.",
  content_too_large: "The file is too large.",
  guard_unavailable: "The file could not be checked, so it was not accepted.",
  storage_failed: "The file could not be stored. Please try again.",
  held_for_review: "This file is held for review.",
  artifact_already_decided: "That file has already been decided.",
  content_purged: "The held content has been purged, so it can only be discarded.",
  artifact_discarded: "That file was discarded.",
  file_deleted: "That file was deleted when its retention ended.",
  no_content: "Only a reference was recorded.",
  brief_already_reviewed: "That brief has already been reviewed.",
  too_many_delay_sources: "Choose the three biggest delay sources.",
  field_list_fixed: "The fields are the ten named in the intake.",
  findings_incomplete:
    "Something is still missing. See the list of what is needed before finalising.",
  findings_not_draft: "There is no draft to finalise.",
  findings_not_open: "Findings are recorded once the session has been held.",
  correction_reason_required: "These findings are finalised. Say why they are being corrected.",
  disclaimer_changed: "The disclaimer is fixed.",
  duration_stated: "The scope does not state how long anything takes.",
  price_stated: "Do not state a price, a fee or a budget.",
  guarantee_stated: "Do not state a guarantee.",
  sample_record_not_accepted: "Do not paste sample records or values.",
  ai_unavailable: "No suggestion is available. Fill the findings in by hand.",
  output_not_ready: "This needs finalised findings and, to share or download, an approved page.",
  output_out_of_date: "The findings changed after this page was made. Make a new draft.",
  scope_section_missing: "The page needs both an in-scope and an out-of-scope section.",
  generated_section_changed: "That section comes from the findings and cannot be edited.",
  restricted_wording: "The page uses restricted wording that no approved claim covers.",
  over_one_page: "The page is too long. Shorten the summary, next step or scope lists.",
  render_failed: "The PDF could not be made. Please try again.",
  phi_guard: "The text looks like it may contain patient information and was not accepted.",
  forbidden: "You do not have permission to do that.",
  not_found: "That no longer exists.",
};

/** A message safe to show a person: a known reason, else a generic line for the status. */
export function describeCatalogueError(error: unknown): string {
  if (error instanceof CatalogueApiError) {
    const known = error.codes.map((c) => REASONS[c]).find(Boolean);
    if (known) return known;
    if (error.status === 403) return REASONS["forbidden"] as string;
    if (error.status === 404) return REASONS["not_found"] as string;
    if (error.status === 409)
      return "That change conflicts with the current state. Refresh and try again.";
    if (error.status === 400 || error.status === 422)
      return "Please check the details and try again.";
  }
  return "Something went wrong. Please try again.";
}

export const newKey = (): string => globalThis.crypto.randomUUID();

export async function call<T>(
  method: string,
  path: string,
  key?: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(key ? { "idempotency-key": key } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const problem = (await response.json().catch(() => ({}))) as { codes?: unknown };
    const codes = Array.isArray(problem.codes)
      ? problem.codes.filter((c): c is string => typeof c === "string")
      : [];
    throw new CatalogueApiError(response.status, codes);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
