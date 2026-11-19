import { describe, expect, it } from "vitest";
import { fail, guardedCall, ok, type ProviderCallLog } from "../src/index.js";

// Task T015: the provider-call wrapper. A PHI-like payload never reaches the provider; the correlation id
// reaches the log line and the typed result; logs carry no payload.
describe("guardedCall", () => {
  it("blocks a PHI-like payload before the provider and returns a typed error with rule ids only", async () => {
    let called = false;
    const logs: ProviderCallLog[] = [];
    const r = await guardedCall({
      provider: "p",
      operation: "complete",
      correlationId: "corr-9",
      payload: { text: "Patient SSN 000-12-3456 on file" },
      call: async () => {
        called = true;
        return ok("x");
      },
      log: (l) => logs.push(l),
    });
    expect(called).toBe(false);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("phi_blocked");
      expect(r.error.retryable).toBe(false);
      expect(r.error.ruleIds?.length).toBeGreaterThan(0);
    }
    expect(r.correlationId).toBe("corr-9");
    expect(logs[0]).toMatchObject({ outcome: "phi_blocked", correlationId: "corr-9" });
    expect(JSON.stringify(logs)).not.toContain("000-12-3456");
  });
  it("passes a clean payload through, propagates the correlation id and logs without the payload", async () => {
    const logs: ProviderCallLog[] = [];
    const r = await guardedCall({
      provider: "p",
      operation: "complete",
      correlationId: "corr-1",
      payload: { text: "The exchange published an updated guide." },
      call: async () => ok("fine"),
      log: (l) => logs.push(l),
      now: () => 5,
    });
    expect(r).toEqual({ ok: true, value: "fine", correlationId: "corr-1" });
    expect(logs).toEqual([
      {
        provider: "p",
        operation: "complete",
        correlationId: "corr-1",
        outcome: "ok",
        durationMs: 0,
      },
    ]);
    expect(JSON.stringify(logs)).not.toContain("exchange");
  });
  it("maps provider errors and exceptions to typed errors", async () => {
    const e1 = await guardedCall({
      provider: "p",
      operation: "o",
      correlationId: null,
      payload: {},
      call: async () => fail("rate_limited", true),
    });
    expect(e1.ok === false && e1.error).toEqual({ code: "rate_limited", retryable: true });
    const e2 = await guardedCall({
      provider: "p",
      operation: "o",
      correlationId: null,
      payload: {},
      call: async () => {
        throw new Error("boom with secret");
      },
    });
    expect(e2.ok === false && e2.error).toEqual({ code: "provider_exception", retryable: true });
  });
});
