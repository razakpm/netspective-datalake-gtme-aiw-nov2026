import { describe, expect, it } from "vitest";
import {
  FOUNDATION_ROLE_PERMISSIONS,
  isRestrictedPermission,
  ROLE_KEYS,
  type Permission,
} from "../../src/index.js";

// Feature 002 role matrix (research R-08; hypothesis, open question #32).
const F002: Permission[] = [
  "accounts.read",
  "accounts.import",
  "accounts.edit",
  "contacts.read",
  "contacts.import",
  "contacts.edit",
  "contacts.erase",
  "stakeholders.edit",
  "evidence.record",
  "review.decide",
  "icp.read",
  "icp.assess",
  "icp.manage",
  "icp.override",
  "suppressions.lift",
];

const EXPECTED: Record<string, Permission[]> = {
  gtm_operator: [
    "accounts.read",
    "accounts.import",
    "accounts.edit",
    "contacts.read",
    "contacts.import",
    "contacts.edit",
    "stakeholders.edit",
    "evidence.record",
    "review.decide",
    "icp.read",
    "icp.assess",
  ],
  research_analyst: ["accounts.read", "contacts.read", "icp.read", "icp.assess"],
  technical_sme_reviewer: ["accounts.read", "contacts.read", "icp.read"],
  sales_service_lead: [
    "accounts.read",
    "contacts.read",
    "icp.read",
    "stakeholders.edit",
    "evidence.record",
  ],
  campaign_approver: [],
  read_only_executive: ["accounts.read", "contacts.read", "icp.read"],
  administrator: F002,
};

describe("feature 002 role matrix", () => {
  for (const role of ROLE_KEYS) {
    it(`${role} holds exactly the expected feature 002 permissions`, () => {
      const held = FOUNDATION_ROLE_PERMISSIONS[role].filter((p) => F002.includes(p)).sort();
      expect(held).toEqual([...EXPECTED[role]!].sort());
    });
  }

  it("keeps administrator-only actions restricted (humans only)", () => {
    for (const key of ["icp.manage", "icp.override", "suppressions.lift", "contacts.erase"]) {
      expect(isRestrictedPermission(key)).toBe(true);
      const holders = ROLE_KEYS.filter((r) =>
        FOUNDATION_ROLE_PERMISSIONS[r].includes(key as Permission),
      );
      expect(holders).toEqual(["administrator"]);
    }
  });
});
