import { createHash } from "node:crypto";

// Normalisation and content fingerprint for de-duplication (spec FR-020; research R-03). Pure.

/** Normalise an observation for comparison: NFKC, lower case, punctuation to spaces, collapsed. */
export function normaliseObservation(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** SHA-256 over account, type and normalised text. The source is deliberately not part of it. */
export function contentFingerprint(
  accountId: string,
  typeKey: string,
  observation: string,
): string {
  return createHash("sha256")
    .update(`${accountId}|${typeKey}|${normaliseObservation(observation)}`)
    .digest("hex");
}

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i;

/** Canonical form of a URL or identifier, so the same item written two ways compares equal. */
export function canonicaliseSourceRef(ref: string): string {
  const trimmed = ref.trim();
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return trimmed;
    url.hash = "";
    url.hostname = url.hostname.toLowerCase();
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    let out = url.toString();
    if (out.endsWith("/") && url.pathname !== "/") out = out.slice(0, -1);
    if (url.pathname === "/" && !url.search) out = out.replace(/\/$/, "");
    return out;
  } catch {
    return trimmed;
  }
}
