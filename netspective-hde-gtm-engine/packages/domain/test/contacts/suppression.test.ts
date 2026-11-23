import { describe, expect, it } from "vitest";
import {
  keyedEmailHash,
  canonicalEmail,
  suppressionStatus,
  type SuppressionRecordLike,
} from "../../src/contacts/suppression.js";

const rec = (over: Partial<SuppressionRecordLike>): SuppressionRecordLike => ({
  id: "s1",
  scope: "contact",
  contactId: "c1",
  accountId: null,
  emailHash: null,
  action: "add",
  recordedAt: "2026-11-01T00:00:00.000Z",
  ...over,
});
const who = { contactId: "c1", accountId: "a1", emailHash: "h1" };

describe("canonicalEmail and keyedEmailHash", () => {
  it("trims and lower-cases but keeps a plus tag", () => {
    expect(canonicalEmail("  Pat.Unsub+tag@Example.ORG ")).toBe("pat.unsub+tag@example.org");
  });
  it("is keyed and stable, and differs by key and by address", () => {
    const a = keyedEmailHash("pat@example.org", "k".repeat(32));
    expect(a).toBe(keyedEmailHash(" PAT@example.org", "k".repeat(32)));
    expect(a).not.toBe(keyedEmailHash("pat@example.org", "j".repeat(32)));
    expect(a).not.toBe(keyedEmailHash("pam@example.org", "k".repeat(32)));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("suppressionStatus (single eligibility check)", () => {
  it("is not suppressed with no records", () => {
    expect(suppressionStatus(who, [])).toEqual({ suppressed: false });
  });
  it.each([
    ["a contact record", rec({ scope: "contact", contactId: "c1" }), "contact"],
    [
      "a keyed hash record",
      rec({ scope: "contact", contactId: null, emailHash: "h1" }),
      "email_hash",
    ],
    ["an account record", rec({ scope: "account", contactId: null, accountId: "a1" }), "account"],
    ["an erasure marker", rec({ action: "erase_marker" }), "contact"],
  ])("suppresses on %s", (_n, record, scope) => {
    expect(suppressionStatus(who, [record])).toEqual({ suppressed: true, scope });
  });
  it("lets a later lift undo an earlier add, and a later add undo a lift", () => {
    const add = rec({ id: "s1", recordedAt: "2026-11-01T00:00:00.000Z" });
    const lift = rec({ id: "s2", action: "lift", recordedAt: "2026-11-02T00:00:00.000Z" });
    const add2 = rec({ id: "s3", recordedAt: "2026-11-03T00:00:00.000Z" });
    expect(suppressionStatus(who, [add, lift]).suppressed).toBe(false);
    expect(suppressionStatus(who, [add, lift, add2]).suppressed).toBe(true);
    expect(suppressionStatus(who, [add2, lift, add]).suppressed).toBe(true);
  });
  it("ignores records for other people, accounts and hashes", () => {
    expect(
      suppressionStatus(who, [
        rec({ contactId: "c2" }),
        rec({ scope: "account", contactId: null, accountId: "a2" }),
        rec({ scope: "contact", contactId: null, emailHash: "h2" }),
      ]).suppressed,
    ).toBe(false);
  });
  it("checks each scope on its own: a contact lift does not lift the account", () => {
    const account = rec({ id: "s1", scope: "account", contactId: null, accountId: "a1" });
    const lift = rec({ id: "s2", action: "lift", recordedAt: "2026-11-02T00:00:00.000Z" });
    expect(suppressionStatus(who, [account, lift])).toEqual({ suppressed: true, scope: "account" });
  });
  it("works with no contact yet (account and hash only)", () => {
    expect(
      suppressionStatus({ contactId: null, accountId: "a1", emailHash: "h1" }, [
        rec({ scope: "account", contactId: null, accountId: "a1" }),
      ]).suppressed,
    ).toBe(true);
  });
});
