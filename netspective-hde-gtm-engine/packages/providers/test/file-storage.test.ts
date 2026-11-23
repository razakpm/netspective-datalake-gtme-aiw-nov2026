import { describe, expect, it } from "vitest";
import { FakeFileStorage } from "../src/fakes/file-storage.js";
import { signToken, verifyToken } from "../src/interfaces/file-storage.js";

const KEY = "k".repeat(32);
const at = new Date("2026-11-23T10:00:00.000Z");
const later = (h: number) => new Date(at.getTime() + h * 3_600_000);

describe("signed download tokens", () => {
  it("round-trips the key and verifies before the expiry", () => {
    const token = signToken(KEY, "register.pdf", later(24));
    expect(verifyToken(KEY, token, at)).toEqual({
      ok: true,
      key: "register.pdf",
      expiresAt: later(24),
    });
  });
  it("refuses an expired token", () => {
    const token = signToken(KEY, "register.pdf", later(24));
    expect(verifyToken(KEY, token, later(24))).toEqual({ ok: false, reason: "expired" });
    expect(verifyToken(KEY, token, later(25))).toEqual({ ok: false, reason: "expired" });
  });
  it("refuses a tampered token, a different key and malformed input", () => {
    const token = signToken(KEY, "register.pdf", later(24));
    const [payload, sig] = token.split(".");
    expect(verifyToken(KEY, `${payload}x.${sig}`, at)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyToken(KEY, `${payload}.${sig}x`, at)).toEqual({ ok: false, reason: "invalid" });
    expect(verifyToken("j".repeat(32), token, at)).toEqual({ ok: false, reason: "invalid" });
    for (const bad of ["", "abc", "a.b.c", ".", "a."]) {
      expect(verifyToken(KEY, bad, at)).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("does not let the expiry be extended by editing the payload", () => {
    const token = signToken(KEY, "register.pdf", later(1));
    const [payload, sig] = token.split(".") as [string, string];
    const decoded = Buffer.from(payload, "base64url").toString();
    const forged = Buffer.from(decoded.replace(/\d+$/, "99999999999")).toString("base64url");
    expect(verifyToken(KEY, `${forged}.${sig}`, at)).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("FakeFileStorage", () => {
  it("stores and returns bytes, and returns null for a missing key", async () => {
    const files = new FakeFileStorage(KEY);
    files.put("register.pdf", Buffer.from("synthetic register"), "application/pdf");
    const got = await files.get("register.pdf");
    expect(got?.contentType).toBe("application/pdf");
    expect(got?.size).toBe(18);
    const chunks: Buffer[] = [];
    for await (const c of got!.stream) chunks.push(Buffer.from(c));
    expect(Buffer.concat(chunks).toString()).toBe("synthetic register");
    expect(await files.get("missing.pdf")).toBeNull();
  });
  it("signs and verifies through the provider", () => {
    const files = new FakeFileStorage(KEY);
    const token = files.sign("register.pdf", later(24));
    expect(files.verify(token, at)).toMatchObject({ ok: true, key: "register.pdf" });
    expect(files.verify(token, later(30))).toEqual({ ok: false, reason: "expired" });
  });
});
