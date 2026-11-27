import { describe, expect, it } from "vitest";
import {
  canAssignRole,
  effectivePermissions,
  FOUNDATION_ROLE_PERMISSIONS,
  hasPermission,
  isRestrictedPermission,
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
        "capabilities.read",
        "claims.draft",
        "claims.read",
        "contacts.edit",
        "contacts.import",
        "contacts.read",
        "evidence.record",
        "hypotheses.edit",
        "hypotheses.read",
        "icp.assess",
        "icp.read",
        "jobs.read",
        "offers.read",
        "offers.recommend",
        "requests.read",
        "requests.review",
        "research.read",
        "research.run",
        "review.decide",
        "signals.read",
        "signals.record",
        "stakeholders.edit",
        "waitlist.edit",
        "webhooks.read",
        "workshops.edit",
        "workshops.read",
      ].sort(),
    );
  });

  it("gives administrator every foundation permission", () => {
    expect(effectivePermissions([role("administrator")])).toEqual([...PERMISSIONS].sort());
  });

  it("gives campaign_approver only the claim and notice permissions (features 005, 006)", () => {
    expect(effectivePermissions([role("campaign_approver")])).toEqual(
      [
        "claims.approve",
        "claims.draft",
        "claims.phrases.manage",
        "claims.read",
        "notices.approve",
        "notices.manage",
      ].sort(),
    );
  });

  it("keeps routing, notice and wait-list permissions with the right roles (feature 006)", () => {
    for (const key of ["routing.rules.manage", "notices.approve"]) {
      expect(isRestrictedPermission(key)).toBe(true);
    }
    const holders = (p: string) =>
      ROLE_KEYS.filter((r) => (FOUNDATION_ROLE_PERMISSIONS[r] as readonly string[]).includes(p));
    expect(holders("routing.rules.manage")).toEqual(["sales_service_lead", "administrator"]);
    expect(holders("notices.approve")).toEqual(["campaign_approver", "administrator"]);
    expect(holders("offers.recommend")).toEqual([
      "gtm_operator",
      "sales_service_lead",
      "administrator",
    ]);
    expect(holders("requests.read")).toEqual([
      "gtm_operator",
      "research_analyst",
      "sales_service_lead",
      "administrator",
    ]);
  });

  it("keeps claim and paid-type approval restricted and held only by the right roles (feature 005)", () => {
    for (const key of ["claims.approve", "paid_types.approve"]) {
      expect(isRestrictedPermission(key)).toBe(true);
    }
    const holders = (p: string) =>
      ROLE_KEYS.filter((r) => (FOUNDATION_ROLE_PERMISSIONS[r] as readonly string[]).includes(p));
    expect(holders("claims.approve")).toEqual([
      "sales_service_lead",
      "campaign_approver",
      "administrator",
    ]);
    expect(holders("paid_types.approve")).toEqual(["sales_service_lead", "administrator"]);
    expect(holders("capabilities.examples.read")).toEqual(["sales_service_lead", "administrator"]);
  });

  it("keeps workshop permissions with the right roles (feature 007)", () => {
    expect(isRestrictedPermission("workshops.output.approve")).toBe(true);
    expect(isRestrictedPermission("workshops.edit")).toBe(false);
    const holders = (p: string) =>
      ROLE_KEYS.filter((r) => (FOUNDATION_ROLE_PERMISSIONS[r] as readonly string[]).includes(p));
    expect(holders("workshops.read")).toEqual([
      "gtm_operator",
      "research_analyst",
      "technical_sme_reviewer",
      "sales_service_lead",
      "administrator",
      "read_only_executive",
    ]);
    expect(holders("workshops.edit")).toEqual([
      "gtm_operator",
      "sales_service_lead",
      "administrator",
    ]);
    expect(holders("workshops.output.approve")).toEqual(["sales_service_lead", "administrator"]);
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
