// Approved research sources: address normalisation and rule matching (feature 004, research R-09).
// Pure. A rule matches a host exactly or by suffix; look-alike hosts never match, and only enabled rules
// count. https is required.

const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$)/i;

/** Canonical https address, or null if it is not a plain https URL. */
export function normaliseAddress(address: string): string | null {
  let url: URL;
  try {
    url = new URL(address.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !url.hostname) return null;
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()])
    if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  let out = url.toString();
  if (url.pathname === "/" && !url.search && out.endsWith("/")) out = out.slice(0, -1);
  return out;
}

export interface ApprovedRule {
  id: string;
  matchType: "host" | "host_suffix";
  pattern: string;
  status: "enabled" | "disabled";
}

export function matchApprovedRule<R extends ApprovedRule>(
  address: string,
  rules: readonly R[],
): R | null {
  const normalised = normaliseAddress(address);
  if (!normalised) return null;
  const host = new URL(normalised).hostname;
  for (const rule of rules) {
    if (rule.status !== "enabled") continue;
    if (rule.matchType === "host" && host === rule.pattern) return rule;
    if (
      rule.matchType === "host_suffix" &&
      (host === rule.pattern || host.endsWith(`.${rule.pattern}`))
    )
      return rule;
  }
  return null;
}
