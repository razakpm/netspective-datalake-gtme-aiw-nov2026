import { describe, expect, it } from "vitest";
import { checkFormToken, honeypotFilled, signFormToken } from "../src/modules/engagement/abuse.js";

// Task T039: the signed form token and the honeypot (feature 006, research R-08).
const KEY = "k".repeat(32);
const LIMITS = { minSeconds: 3, maxAgeHours: 24 };
const t0 = new Date("2026-11-23T10:00:00.000Z");
const after = (seconds: number) => new Date(t0.getTime() + seconds * 1000);

describe("form token", () => {
  const token = signFormToken(KEY, "slug-a", t0);
  it("is accepted between the minimum and maximum age", () => {
    expect(checkFormToken(KEY, token, "slug-a", after(3), LIMITS)).toEqual({
      ok: true,
      issuedAt: t0,
    });
    expect(checkFormToken(KEY, token, "slug-a", after(24 * 3600), LIMITS).ok).toBe(true);
  });
  it("is refused when sent too fast or too late", () => {
    expect(checkFormToken(KEY, token, "slug-a", after(2), LIMITS)).toEqual({
      ok: false,
      reason: "too_fast",
    });
    expect(checkFormToken(KEY, token, "slug-a", after(24 * 3600 + 1), LIMITS)).toEqual({
      ok: false,
      reason: "expired",
    });
  });
  it("is refused when tampered, for another form, signed with another key or malformed", () => {
    const [payload, sig] = token.split(".") as [string, string];
    expect(checkFormToken(KEY, `${payload}.${sig.slice(1)}a`, "slug-a", after(10), LIMITS)).toEqual(
      { ok: false, reason: "invalid" },
    );
    expect(checkFormToken(KEY, token, "slug-b", after(10), LIMITS)).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(checkFormToken("j".repeat(32), token, "slug-a", after(10), LIMITS)).toEqual({
      ok: false,
      reason: "invalid",
    });
    for (const bad of ["", ".", "a.b.c", "abc", `${payload}.`]) {
      expect(checkFormToken(KEY, bad, "slug-a", after(10), LIMITS)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
  });
  it("cannot be backdated by editing the time", () => {
    const [payload, sig] = token.split(".") as [string, string];
    const forged = Buffer.from(
      Buffer.from(payload, "base64url").toString().replace(/\d+$/, "1"),
    ).toString("base64url");
    expect(checkFormToken(KEY, `${forged}.${sig}`, "slug-a", after(10), LIMITS)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});

describe("honeypot", () => {
  it("is filled by anything other than an empty or missing value", () => {
    expect(honeypotFilled(undefined)).toBe(false);
    expect(honeypotFilled("")).toBe(false);
    expect(honeypotFilled("   ")).toBe(false);
    expect(honeypotFilled("http://spam.example")).toBe(true);
    expect(honeypotFilled(0)).toBe(true);
  });
});
