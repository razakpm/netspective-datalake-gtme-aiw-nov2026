import { isIP } from "node:net";

// Address checks for the web fetch adapter (feature 004, research R-09). Private, loopback, link-local,
// carrier-grade NAT, multicast and metadata addresses are never fetched.

function v4(parts: number[]): boolean {
  const [a, b] = parts as [number, number];
  return (
    a === 10 ||
    a === 0 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
}

/** True when the literal IP address may be fetched. */
export function isPublicAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return !v4(ip.split(".").map(Number));
  if (kind === 6) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return !v4(mapped[1]!.split(".").map(Number));
    if (lower === "::" || lower === "::1") return false;
    if (/^f[cd]/.test(lower) || /^fe[89ab]/.test(lower) || lower.startsWith("ff")) return false;
    return true;
  }
  return false;
}

export type Resolver = (host: string) => Promise<string[]>;

/** Every address the host resolves to must be public. */
export async function hostIsPublic(host: string, resolve: Resolver): Promise<boolean> {
  if (isIP(host)) return isPublicAddress(host);
  try {
    const addresses = await resolve(host);
    return addresses.length > 0 && addresses.every(isPublicAddress);
  } catch {
    return false;
  }
}
