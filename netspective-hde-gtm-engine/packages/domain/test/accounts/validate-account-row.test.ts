import { describe, expect, it } from "vitest";
import { validateAccountRow } from "../../src/index.js";

describe("validateAccountRow", () => {
  it("accepts a valid row and normalises it", () => {
    const r = validateAccountRow({
      name: " Acme Health ",
      aliases: "Acme; Acme Co",
      domains: "WWW.Acme.example; acme.example",
      type: "health_system",
      staffed_beds: "300",
    });
    expect(r).toEqual({
      ok: true,
      value: {
        name: "Acme Health",
        aliases: ["Acme", "Acme Co"],
        domains: ["acme.example"],
        orgType: "health_system",
        geography: null,
        notes: null,
        staffedBedCount: 300,
      },
    });
  });
  it("treats a blank type as unknown (never assumed to be a target type)", () => {
    const r = validateAccountRow({ name: "X" });
    expect(r.ok && r.value.orgType).toBe("unknown");
  });
  it("reports reason codes only", () => {
    const r = validateAccountRow({
      name: "",
      type: "nope",
      domains: "https://x.example/p",
      staffed_beds: "-5",
      notes: "n".repeat(2001),
    });
    expect(r).toEqual({
      ok: false,
      reasons: [
        "missing_name",
        "invalid_type",
        "invalid_domain",
        "notes_too_long",
        "invalid_staffed_beds",
      ],
    });
  });
});
