import { describe, expect, it, vi } from "vitest";
import {
  evaluateSession,
  guardSession,
  loadSessionPolicy,
  type SessionPolicy,
} from "../src/auth/session-policy.js";

const HOUR = 3_600_000;
const MIN = 60_000;
const policy: SessionPolicy = { absoluteMs: 8 * HOUR, idleMs: 30 * MIN };
const t0 = 1_000_000_000;
const session = { idToken: "tok", issuedAt: t0, lastActivityAt: t0 };

describe("session policy defaults and configuration", () => {
  it("defaults to 8 hours absolute and 30 minutes idle", () => {
    expect(loadSessionPolicy({})).toEqual(policy);
  });

  it("is configurable and rejects nonsense", () => {
    expect(loadSessionPolicy({ SESSION_ABSOLUTE_HOURS: "2", SESSION_IDLE_MINUTES: "10" })).toEqual({
      absoluteMs: 2 * HOUR,
      idleMs: 10 * MIN,
    });
    expect(() => loadSessionPolicy({ SESSION_IDLE_MINUTES: "0" })).toThrow(/SESSION_IDLE_MINUTES/);
    expect(() => loadSessionPolicy({ SESSION_ABSOLUTE_HOURS: "abc" })).toThrow(
      /SESSION_ABSOLUTE_HOURS/,
    );
  });
});

describe("evaluateSession", () => {
  it("is valid inside both limits", () => {
    expect(evaluateSession(session, t0 + 10 * MIN, policy)).toBe("valid");
  });
  it("expires after the idle timeout", () => {
    expect(evaluateSession(session, t0 + 31 * MIN, policy)).toBe("idle_expired");
  });
  it("expires after the absolute lifetime even when active", () => {
    const active = { ...session, lastActivityAt: t0 + 8 * HOUR - MIN };
    expect(evaluateSession(active, t0 + 8 * HOUR + MIN, policy)).toBe("absolute_expired");
  });
  it("treats a missing or malformed session as expired", () => {
    expect(evaluateSession(null, t0, policy)).toBe("missing");
    expect(evaluateSession({ ...session, issuedAt: Number.NaN }, t0, policy)).toBe("missing");
  });
});

describe("guardSession (FR-054, SC-016)", () => {
  const check = (status: number) => vi.fn(async () => status);

  it("allows a valid session after the API confirms it, and refreshes the activity time", async () => {
    const api = check(200);
    const result = await guardSession({ session, now: t0 + MIN, policy, checkSession: api });
    expect(result).toEqual({ action: "allow", session: { ...session, lastActivityAt: t0 + MIN } });
    expect(api).toHaveBeenCalledWith("tok");
  });

  it("signs out an idle-expired session and performs no API call", async () => {
    const api = check(200);
    const result = await guardSession({ session, now: t0 + 31 * MIN, policy, checkSession: api });
    expect(result).toEqual({ action: "sign_out", reason: "idle_expired" });
    expect(api).not.toHaveBeenCalled();
  });

  it("signs out an absolute-expired session and performs no API call", async () => {
    const api = check(200);
    const old = { ...session, lastActivityAt: t0 + 8 * HOUR };
    const result = await guardSession({
      session: old,
      now: t0 + 8 * HOUR + 1,
      policy,
      checkSession: api,
    });
    expect(result).toEqual({ action: "sign_out", reason: "absolute_expired" });
    expect(api).not.toHaveBeenCalled();
  });

  it("signs out without a call when there is no session", async () => {
    const api = check(200);
    expect(await guardSession({ session: null, now: t0, policy, checkSession: api })).toEqual({
      action: "sign_out",
      reason: "missing",
    });
    expect(api).not.toHaveBeenCalled();
  });

  it("signs out a deactivated user (403) and an invalid token (401)", async () => {
    for (const status of [401, 403]) {
      const result = await guardSession({
        session,
        now: t0 + MIN,
        policy,
        checkSession: check(status),
      });
      expect(result).toEqual({ action: "sign_out", reason: "rejected" });
    }
  });

  it("fails closed when the API cannot confirm the session (503 or a thrown error)", async () => {
    expect(
      await guardSession({ session, now: t0 + MIN, policy, checkSession: check(503) }),
    ).toEqual({
      action: "unavailable",
    });
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await guardSession({ session, now: t0 + MIN, policy, checkSession: boom })).toEqual({
      action: "unavailable",
    });
  });
});
