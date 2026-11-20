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
