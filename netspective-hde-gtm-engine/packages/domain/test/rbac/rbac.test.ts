import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  effectivePermissions,
  FOUNDATION_ROLE_PERMISSIONS,
  hasPermission,
  PERMISSIONS,
  ROLE_KEYS,
} from "../../src/index.js";

const role = (key: (typeof ROLE_KEYS)[number]) => ({
  key,
  permissions: FOUNDATION_ROLE_PERMISSIONS[key],
});

describe("effective permissions", () => {
  it("is empty for a user with no roles (deny by default)", () => {
    expect(effectivePermissions([])).toEqual([]);
    expect(hasPermission([], "users.manage")).toBe(false);
  });

  it("is exactly the union of the role permissions, sorted and without duplicates", () => {
    const roles = [role("gtm_operator"), role("read_only_executive")];
    expect(effectivePermissions(roles)).toEqual(
      [
        "accounts.edit",
        "accounts.import",
        "accounts.read",
        "ai_invocations.read",
        "audit.read",
        "contacts.edit",
        "contacts.import",
        "contacts.read",
        "evidence.record",
        "icp.assess",
        "icp.read",
        "jobs.read",
        "review.decide",
        "signals.read",
        "signals.record",
        "stakeholders.edit",
        "webhooks.read",
      ].sort(),
    );
  });

  it("gives administrator every foundation permission", () => {
    expect(effectivePermissions([role("administrator")])).toEqual([...PERMISSIONS].sort());
  });

  it("grants nothing to campaign_approver in this feature", () => {
    expect(effectivePermissions([role("campaign_approver")])).toEqual([]);
  });

  it("has no deny rules: adding a role never removes a permission", () => {
    const one = effectivePermissions([role("gtm_operator")]);
    const two = effectivePermissions([role("gtm_operator"), role("campaign_approver")]);
    expect(two).toEqual(expect.arrayContaining(one));
  });

  it("ignores permission keys it does not know", () => {
    expect(effectivePermissions([{ key: "x", permissions: ["bogus.perm", "jobs.read"] }])).toEqual([
      "jobs.read",
    ]);
  });

  it("answers hasPermission from the union", () => {
    const roles = [role("gtm_operator")];
    expect(hasPermission(roles, "jobs.read")).toBe(true);
    expect(hasPermission(roles, "users.manage")).toBe(false);
  });
});

describe("canAssignRole", () => {
  it("lets human users hold any role", () => {
    for (const key of ROLE_KEYS) expect(canAssignRole("human", role(key)).allowed).toBe(true);
  });

  it.each(["ai", "system"] as const)("refuses restricted roles to %s actors", (actorType) => {
    for (const key of ["administrator", "campaign_approver", "technical_sme_reviewer"] as const) {
      const result = canAssignRole(actorType, role(key));
      expect(result.allowed).toBe(false);
    }
  });

  it.each(["ai", "system"] as const)(
    "refuses any role carrying users.manage, approval or quarantine.review to %s",
    (actorType) => {
      for (const permission of ["users.manage", "quarantine.review", "campaign.approve"]) {
        expect(canAssignRole(actorType, { key: "custom", permissions: [permission] }).allowed).toBe(
          false,
        );
      }
    },
  );

  it("refuses an unrecognised actor type", () => {
    expect(canAssignRole("robot" as never, role("gtm_operator")).allowed).toBe(false);
  });
});
