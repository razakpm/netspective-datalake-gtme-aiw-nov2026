import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_POLICY,
  nextAfterFailure,
  retryDelayMs,
  type RetryPolicy,
} from "../../src/index.js";

const noJitter: RetryPolicy = { ...DEFAULT_RETRY_POLICY, jitterRatio: 0 };

describe("retry delay (FR-025)", () => {
  it("defaults to 5 attempts, 30 s base, factor 2, a 1 h cap and 20% jitter", () => {
    expect(DEFAULT_RETRY_POLICY).toEqual({
      maxAttempts: 5,
      baseSeconds: 30,
      factor: 2,
      capSeconds: 3600,
      jitterRatio: 0.2,
    });
  });

  it("increases with each attempt, doubling from the base", () => {
    const delays = [1, 2, 3, 4, 5].map((n) => retryDelayMs(n, noJitter, () => 0));
    expect(delays).toEqual([30_000, 60_000, 120_000, 240_000, 480_000]);
  });

  it("never exceeds the cap, even for huge attempt numbers", () => {
    expect(retryDelayMs(50, noJitter, () => 0)).toBe(3_600_000);
    expect(retryDelayMs(10_000, noJitter, () => 0)).toBe(3_600_000);
  });

  it("applies jitter within bounds: between (1 - ratio) and 1 times the delay", () => {
    const low = retryDelayMs(3, DEFAULT_RETRY_POLICY, () => 1);
    const high = retryDelayMs(3, DEFAULT_RETRY_POLICY, () => 0);
    expect(high).toBe(120_000);
    expect(low).toBe(96_000);
    for (let i = 0; i < 100; i++) {
      const d = retryDelayMs(3, DEFAULT_RETRY_POLICY);
      expect(d).toBeGreaterThanOrEqual(96_000);
      expect(d).toBeLessThanOrEqual(120_000);
    }
  });

  it("never goes above the cap after jitter and is a whole number of milliseconds", () => {
    for (let n = 1; n < 20; n++) {
      const d = retryDelayMs(n, DEFAULT_RETRY_POLICY);
      expect(d).toBeLessThanOrEqual(3_600_000);
      expect(Number.isInteger(d)).toBe(true);
    }
  });

  it("rejects nonsense input", () => {
    expect(() => retryDelayMs(0, DEFAULT_RETRY_POLICY)).toThrow();
    expect(() => retryDelayMs(1, { ...DEFAULT_RETRY_POLICY, factor: 0.5 })).toThrow();
    expect(() => retryDelayMs(1, { ...DEFAULT_RETRY_POLICY, jitterRatio: 1.5 })).toThrow();
  });
});

describe("terminal-state rule", () => {
  it("retries while attempts remain and fails when they are exhausted", () => {
    expect(nextAfterFailure(1, DEFAULT_RETRY_POLICY)).toBe("retry");
    expect(nextAfterFailure(4, DEFAULT_RETRY_POLICY)).toBe("retry");
    expect(nextAfterFailure(5, DEFAULT_RETRY_POLICY)).toBe("fail");
    expect(nextAfterFailure(6, DEFAULT_RETRY_POLICY)).toBe("fail");
  });

  it("never allows more attempts than the maximum", () => {
    let attempts = 0;
    let state = "retry";
    while (state === "retry") {
      attempts += 1;
      state = nextAfterFailure(attempts, { ...DEFAULT_RETRY_POLICY, maxAttempts: 3 });
    }
    expect(attempts).toBe(3);
  });
});
