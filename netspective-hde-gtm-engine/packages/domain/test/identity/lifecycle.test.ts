import { describe, expect, it } from "vitest";
import { checkRoleRemoval, checkTransition, USER_STATUSES } from "../../src/index.js";

const ok = { ok: true };
const common = { isAdministrator: false, activeAdministrators: 2 };

describe("user status transitions", () => {
  it.each([
    ["invited", "active"],
    ["active", "deactivated"],
    ["deactivated", "active"],
    ["invited", "deactivated"],
  ] as const)("allows %s -> %s", (from, to) => {
    expect(checkTransition({ from, to, ...common })).toEqual(ok);
  });

  it("rejects every other transition", () => {
    const legal = new Set([
      "invited>active",
      "active>deactivated",
      "deactivated>active",
      "invited>deactivated",
    ]);
    for (const from of USER_STATUSES)
      for (const to of USER_STATUSES) {
        if (legal.has(`${from}>${to}`)) continue;
        const result = checkTransition({ from, to, ...common });
        expect(result.ok).toBe(false);
      }
  });

  it("rejects an unknown status", () => {
    expect(checkTransition({ from: "gone" as never, to: "active", ...common }).ok).toBe(false);
  });
});

describe("last administrator rule", () => {
  it("rejects deactivating the only active administrator", () => {
    const result = checkTransition({
      from: "active",
      to: "deactivated",
      isAdministrator: true,
      activeAdministrators: 1,
    });
    expect(result).toEqual({ ok: false, reason: "last_administrator" });
  });

  it("allows deactivating an administrator when another remains", () => {
    expect(
      checkTransition({
        from: "active",
        to: "deactivated",
        isAdministrator: true,
        activeAdministrators: 2,
      }),
    ).toEqual(ok);
  });

  it("does not apply to non-administrators", () => {
    expect(
      checkTransition({
        from: "active",
        to: "deactivated",
        isAdministrator: false,
        activeAdministrators: 1,
      }),
    ).toEqual(ok);
  });

  it("rejects removing the administrator role from the only active administrator", () => {
    expect(
      checkRoleRemoval({ roleKey: "administrator", userIsActive: true, activeAdministrators: 1 }),
    ).toEqual({ ok: false, reason: "last_administrator" });
  });

  it("allows removing the role when another administrator remains, or for other roles or inactive users", () => {
    expect(
      checkRoleRemoval({ roleKey: "administrator", userIsActive: true, activeAdministrators: 2 }),
    ).toEqual(ok);
    expect(
      checkRoleRemoval({ roleKey: "gtm_operator", userIsActive: true, activeAdministrators: 1 }),
    ).toEqual(ok);
    expect(
      checkRoleRemoval({ roleKey: "administrator", userIsActive: false, activeAdministrators: 1 }),
    ).toEqual(ok);
  });
});
