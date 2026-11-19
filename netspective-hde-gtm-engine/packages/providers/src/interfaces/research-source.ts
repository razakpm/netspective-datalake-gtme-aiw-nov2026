import type { ProviderResult } from "./result.js";

// Research source provider interface (feature 004, research R-09). A provider fetches ONE address and
// follows redirects itself, but must ask `isApproved` for every hop so a redirect can never leave the
// approved list.

export interface FetchRequest {
  address: string;
  /** Analyst-pasted text: when present, no network call is made for this address. */
  capturedText?: string | undefined;
  maxBytes: number;
  timeoutMs: number;
  isApproved: (address: string) => boolean;
}

export interface FetchedSource {
  address: string;
  finalAddress: string;
  status: number;
  contentType: string;
  text: string;
  sizeBytes: number;
  truncated: boolean;
}

/** Error codes: unreachable, timeout, redirect_not_approved, too_many_redirects, blocked_address,
 *  unsupported_content_type, invalid_address. */
export interface ResearchSourceProvider {
  readonly name: string;
  fetch(request: FetchRequest): Promise<ProviderResult<FetchedSource>>;
}
