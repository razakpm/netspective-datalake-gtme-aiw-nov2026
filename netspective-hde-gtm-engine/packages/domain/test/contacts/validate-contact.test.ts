import { describe, expect, it } from "vitest";
import { validateContact } from "../../src/contacts/validate-contact.js";

const personal = new Set(["gmail.com", "yahoo.com"]);

describe("validateContact", () => {
  it("accepts a business email and normalises it", () => {
    expect(
      validateContact(
        { email: " Alex@Northvale-HIE.example ", role: "Integration Lead" },
        personal,
      ),
    ).toEqual({
      ok: true,
      email: "alex@northvale-hie.example",
      domain: "northvale-hie.example",
      role: "Integration Lead",
    });
  });
  it.each([
    "",
    "no-at-sign",
    "a@b",
    "a b@example.org",
    "a@@example.org",
    "@example.org",
    "a@example..org",
  ])("refuses a malformed email %j", (email) => {
    expect(validateContact({ email, role: "x" }, personal)).toEqual({
      ok: false,
      code: "email_invalid",
    });
  });
  it("refuses a personal domain as a contact, with its own code", () => {
    expect(validateContact({ email: "pat@Gmail.com", role: "x" }, personal)).toEqual({
      ok: false,
      code: "personal_email",
    });
  });
  it("caps the role at 120 characters and treats a blank role as unknown", () => {
    expect(validateContact({ email: "a@example.org", role: "x".repeat(121) }, personal)).toEqual({
      ok: false,
      code: "role_too_long",
    });
    expect(validateContact({ email: "a@example.org", role: "   " }, personal)).toMatchObject({
      ok: true,
      role: null,
    });
  });
});
