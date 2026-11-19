import { describe, expect, it } from "vitest";
import {
  FEATURE004_EVENT_PAYLOADS,
  toAccountResearchedPayload,
  toHypothesisCreatedPayload,
  toHypothesisUpdatedPayload,
} from "../../src/index.js";

describe("feature 004 event payloads", () => {
  it("accept identifiers and counts and nothing else", () => {
    expect(
      toAccountResearchedPayload({
        run_id: "r",
        account_id: "a",
        state: "completed",
        signals_created: 2,
        injection_flags: 0,
        cost_micros: 1200,
      }),
    ).toBeTruthy();
    expect(
      toHypothesisCreatedPayload({ hypothesis_id: "h", account_id: "a", origin: "ai" }),
    ).toBeTruthy();
    expect(
      toHypothesisUpdatedPayload({
        hypothesis_id: "h",
        account_id: "a",
        change: "stale",
        status: "stale",
      }),
    ).toBeTruthy();
  });
  it("reject an extra text field, an unknown state and a negative count", () => {
    const base = {
      run_id: "r",
      account_id: "a",
      state: "completed",
      signals_created: 0,
      injection_flags: 0,
      cost_micros: 0,
    };
    const schema = FEATURE004_EVENT_PAYLOADS["account.researched"];
    expect(schema.safeParse({ ...base, summary: "text" }).success).toBe(false);
    expect(schema.safeParse({ ...base, state: "needs_attention" }).success).toBe(false);
    expect(schema.safeParse({ ...base, cost_micros: -1 }).success).toBe(false);
    expect(
      FEATURE004_EVENT_PAYLOADS["hypothesis.created"].safeParse({
        hypothesis_id: "h",
        account_id: "a",
        origin: "ai",
        statement: "x",
      }).success,
    ).toBe(false);
    expect(
      FEATURE004_EVENT_PAYLOADS["hypothesis.updated"].safeParse({
        hypothesis_id: "h",
        account_id: "a",
        change: "edit",
        status: "untested",
        note: "n",
      }).success,
    ).toBe(false);
  });
});
