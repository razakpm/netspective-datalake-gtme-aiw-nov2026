import { createHmac, timingSafeEqual } from "node:crypto";
import type { Readable } from "node:stream";

// File storage provider interface (feature 006, research R-10): the minimal slice of feature 001's storage
// provider needed to deliver the register. Links are signed with an HMAC and carry their own expiry, so no
// table or email is needed. A key is a plain file name; nothing outside the store's directory is readable.

export interface StoredFile {
  stream: Readable;
  size: number;
  contentType: string;
}

export type VerifiedToken =
  { ok: true; key: string; expiresAt: Date } | { ok: false; reason: "expired" | "invalid" };

export interface FileStorageProvider {
  readonly name: string;
  /** A readable stream for the key, or null when it does not exist or the key is unsafe. */
  get(key: string): Promise<StoredFile | null>;
  /** An opaque token that proves the holder may fetch `key` until `expiresAt`. */
  sign(key: string, expiresAt: Date): string;
  verify(token: string, now: Date): VerifiedToken;
}

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const mac = (secret: string, payload: string) =>
  createHmac("sha256", secret).update(payload).digest("base64url");

export function signToken(secret: string, key: string, expiresAt: Date): string {
  const payload = b64(`${key}|${Math.floor(expiresAt.getTime() / 1000)}`);
  return `${payload}.${mac(secret, payload)}`;
}

export function verifyToken(secret: string, token: string, now: Date): VerifiedToken {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [payload = "", sig = ""] = parts;
  if (payload === "" || sig === "") return { ok: false, reason: "invalid" };
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "invalid" };
  }
  const decoded = Buffer.from(payload, "base64url").toString();
  const cut = decoded.lastIndexOf("|");
  const seconds = Number(decoded.slice(cut + 1));
  if (cut < 1 || !Number.isInteger(seconds)) return { ok: false, reason: "invalid" };
  const expiresAt = new Date(seconds * 1000);
  if (now.getTime() >= expiresAt.getTime()) return { ok: false, reason: "expired" };
  return { ok: true, key: decoded.slice(0, cut), expiresAt };
}
