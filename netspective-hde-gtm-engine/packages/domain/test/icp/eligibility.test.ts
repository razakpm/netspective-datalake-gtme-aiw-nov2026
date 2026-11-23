import { describe, expect, it } from "vitest";
import { priorityEligibility } from "../../src/icp/eligibility.js";

describe("priorityEligibility", () => {
  it.each([
    ["strong", { eligible: true }],
    ["possible", { eligible: true }],
    ["weak", { eligible: false, code: "fit_not_priority" }],
    ["unknown", { eligible: false, code: "fit_not_priority" }],
    ["excluded", { eligible: false, code: "account_excluded" }],
  ] as const)("%s", (fit, expected) => {
    expect(priorityEligibility(fit)).toEqual(expected);
  });
});
