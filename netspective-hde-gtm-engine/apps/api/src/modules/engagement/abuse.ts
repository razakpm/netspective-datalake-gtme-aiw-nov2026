import { createHmac, timingSafeEqual } from "node:crypto";

// Abuse protection for the public forms (feature 006, spec FR-029, research R-08): a signed form token with
// a minimum and maximum age, and a hidden honeypot field. No puzzle is shown or solved. The token needs no
// server state: it is an HMAC over the form slug and the time it was issued.

const mac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function signFormToken(secret: string, slug: string, issuedAt: Date): string {
  const payload = Buffer.from(`${slug}|${Math.floor(issuedAt.getTime() / 1000)}`).toString(
    "base64url",
  );
  return `${payload}.${mac(secret, payload)}`;
}

export type TokenCheck =
  { ok: true; issuedAt: Date } | { ok: false; reason: "invalid" | "too_fast" | "expired" };

export function checkFormToken(
  secret: string,
  token: string,
  slug: string,
  now: Date,
  limits: { minSeconds: number; maxAgeHours: number },
): TokenCheck {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [payload = "", sig = ""] = parts;
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(sig);
  if (payload === "" || expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }
  const decoded = Buffer.from(payload, "base64url").toString();
  const cut = decoded.lastIndexOf("|");
  const issuedSeconds = Number(decoded.slice(cut + 1));
  if (cut < 1 || decoded.slice(0, cut) !== slug || !Number.isInteger(issuedSeconds)) {
    return { ok: false, reason: "invalid" };
  }
  const age = now.getTime() / 1000 - issuedSeconds;
  if (age < limits.minSeconds) return { ok: false, reason: "too_fast" };
  if (age > limits.maxAgeHours * 3600) return { ok: false, reason: "expired" };
  return { ok: true, issuedAt: new Date(issuedSeconds * 1000) };
}

/** The hidden field is for bots: a person never fills it. */
export const honeypotFilled = (value: unknown): boolean =>
  typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
