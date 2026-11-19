import { fail, ok, type ProviderResult } from "./interfaces/result.js";
import type { FetchRequest, FetchedSource } from "./interfaces/research-source.js";

// Redirect, size and content-type handling shared by the web adapter and the fake source, so it is tested
// once. A `hop` fetches a single URL without following redirects.

export interface Hop {
  status: number;
  contentType: string;
  location?: string | undefined;
  /** Body text, already limited to at most `maxBytes + 1` bytes by the hop. */
  text: string;
  sizeBytes: number;
}

export type HopFn = (address: string) => Promise<ProviderResult<Hop>>;

const MAX_REDIRECTS = 3;
const ALLOWED_TYPES = ["text/html", "text/plain", "application/json"];

export async function fetchFollowing(
  request: FetchRequest,
  hop: HopFn,
): Promise<ProviderResult<FetchedSource>> {
  let address = request.address;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const result = await hop(address);
    if (!result.ok) return result;
    const h = result.value;
    if (h.status >= 300 && h.status < 400 && h.location) {
      let next: string;
      try {
        next = new URL(h.location, address).toString();
      } catch {
        return fail("invalid_address");
      }
      if (!request.isApproved(next)) return fail("redirect_not_approved");
      address = next;
      continue;
    }
    if (h.status < 200 || h.status >= 300) return fail("unreachable", h.status >= 500);
    const type = h.contentType.split(";")[0]!.trim().toLowerCase();
    if (!ALLOWED_TYPES.includes(type)) return fail("unsupported_content_type");
    const truncated = h.sizeBytes > request.maxBytes;
    const text = truncated
      ? Buffer.from(h.text).subarray(0, request.maxBytes).toString("utf8")
      : h.text;
    return ok({
      address: request.address,
      finalAddress: address,
      status: h.status,
      contentType: type,
      text,
      sizeBytes: Math.min(h.sizeBytes, request.maxBytes + 1),
      truncated,
    });
  }
  return fail("too_many_redirects");
}
