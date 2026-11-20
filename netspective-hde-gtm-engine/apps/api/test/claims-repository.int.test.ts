import { describe, expect, it } from "vitest";
import { DEFAULT_PHRASE_RULES, lintText } from "@gtm/domain";
import { checkText, effectiveStatus, getClaim, listEvidence } from "../src/modules/claims/index.js";
import { buildCatalogueHarness } from "../test-support/catalogue-harness.js";

// Task T025: claims, evidence and the read-side rules (needs_review computed, cover lookup, lint).
const SSN_LIKE = "Contact on file for 123-45-6789 about this.";

describe("drafting a claim", () => {
  it("stores the claim with the effective class: the declared class or what the checker finds", () => {
    const h = buildCatalogueHarness();
    const general = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds." });
    expect(general).toMatchObject({
      status: "draft",
      effectiveClass: "general",
      restricted: false,
      approvalsNeeded: 1,
    });
    const found = h.claims.draft(h.actor("drafter"), { text: "We are AI-ready." });
    expect(found).toMatchObject({
      effectiveClass: "ai_ready",
      declaredClass: null,
      restricted: true,
      approvalsNeeded: 2,
    });
    const lowered = h.claims.draft(h.actor("drafter"), {
      text: "A SLA applies.",
      declaredClass: "general",
    });
    expect(lowered.effectiveClass).toBe("sla_rto");
  });

  it("accepts 600 characters and refuses 601, and refuses text that is too short", () => {
    const h = buildCatalogueHarness();
    expect(() => h.claims.draft(h.actor("drafter"), { text: "x".repeat(600) })).not.toThrow();
    expect(() => h.claims.draft(h.actor("drafter"), { text: "x".repeat(601) })).toThrow(
      /Invalid fields/,
    );
    expect(() => h.claims.draft(h.actor("drafter"), { text: "ab" })).toThrow(/Invalid fields/);
    expect(h.count("claim")).toBe(1);
  });

  it("refuses text that matches the PHI guard, stores nothing and audits the refusal with codes only", () => {
    const h = buildCatalogueHarness();
    expect(() => h.claims.draft(h.actor("drafter"), { text: SSN_LIKE })).toThrow();
    expect(h.count("claim")).toBe(0);
    const [refusal] = h.audit("claim.draft.refused");
    expect(refusal?.outcome).toBe("denied");
    expect(refusal?.after_summary ?? "").toContain("phi_guard");
    expect(h.anyText(/123-45-6789/)).toBe(false);
  });

  it("needs claims.draft", () => {
    const h = buildCatalogueHarness();
    expect(() => h.claims.draft(h.actor("executive"), { text: "We review feeds." })).toThrow(
      /permission/,
    );
    expect(h.count("claim")).toBe(0);
  });

  it("writes one audit record and one claim.created event with identifiers only", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: "Our case study is attached." });
    expect(h.audit("claim.draft").map((a) => [a.actor_id, a.entity_id])).toEqual([
      ["drafter-1", c.id],
    ]);
    expect(h.outbox("claim.created")).toEqual([
      { claim_id: c.id, effective_class: "customer_identity" },
    ]);
    expect(h.anyText(/case study/i)).toBe(false);
  });
});

describe("evidence and the computed needs_review status", () => {
  it("defaults the expiry to the configured number of months and accepts an explicit expiry", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds." });
    const withDefault = h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "document",
      reference: "doc-1",
      owner: "Service lead",
    });
    expect(withDefault.evidence[0]?.expiresAt).toBe("2027-11-19T10:00:00.000Z");
    const explicit = h.claims.addEvidence(h.actor("drafter"), c.id, {
      kind: "internal_record",
      reference: "rec-2",
      owner: "Service lead",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });
    expect(explicit.evidence.map((e) => e.expiresAt)).toEqual([
      "2027-11-19T10:00:00.000Z",
      "2026-12-31T00:00:00.000Z",
    ]);
    expect(explicit.evidence.every((e) => e.valid)).toBe(true);
  });

  it("refuses PHI-like evidence text whole and evidence on a closed claim", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds." });
    expect(() =>
      h.claims.addEvidence(h.actor("drafter"), c.id, {
        kind: "document",
        reference: SSN_LIKE,
        owner: "Owner",
      }),
    ).toThrow();
    expect(h.count("claim_evidence")).toBe(0);
    h.db.raw.prepare("UPDATE claim SET status = 'withdrawn' WHERE id = ?").run(c.id);
    expect(() =>
      h.claims.addEvidence(h.actor("drafter"), c.id, {
        kind: "document",
        reference: "doc-9",
        owner: "Owner",
      }),
    ).toThrow(/closed/i);
  });

  it("reads an approved claim as needs_review when all its evidence is withdrawn or expired, storing nothing", () => {
    const h = buildCatalogueHarness();
    const live = h.insertApprovedClaim("We review sender feeds.");
    const expired = h.insertApprovedClaim("We map CCDA fields.", {
      expiresAt: "2026-11-01T00:00:00.000Z",
    });
    const withdrawn = h.insertApprovedClaim("We trace pilot inputs.", { withdrawn: true });
    const none = h.insertApprovedClaim("We run workshops.", { evidence: false });
    const status = (id: string) => h.claims.get(h.actor("lead"), id).status;
    expect(status(live)).toBe("approved");
    expect(status(expired)).toBe("needs_review");
    expect(status(withdrawn)).toBe("needs_review");
    expect(status(none)).toBe("needs_review");
    expect(h.db.transaction((tx) => getClaim(tx, expired)?.status)).toBe("approved");
    expect(
      h.claims
        .list(h.actor("lead"), { status: "needs_review" })
        .map((c) => c.id)
        .sort(),
    ).toEqual([expired, withdrawn, none].sort());
    expect(h.claims.list(h.actor("lead"), { status: "approved" }).map((c) => c.id)).toEqual([live]);
  });

  it("turns an approved claim into needs_review as the clock passes the evidence expiry", () => {
    const h = buildCatalogueHarness();
    const id = h.insertApprovedClaim("We review sender feeds.", {
      expiresAt: "2026-12-01T00:00:00.000Z",
    });
    expect(h.claims.get(h.actor("lead"), id).status).toBe("approved");
    h.advanceDays(30);
    expect(h.claims.get(h.actor("lead"), id).status).toBe("needs_review");
    h.db.transaction((tx) => {
      const claim = getClaim(tx, id)!;
      expect(effectiveStatus(claim, listEvidence(tx, id), h.now().toISOString())).toBe(
        "needs_review",
      );
    });
  });
});

describe("cover lookup", () => {
  const check = (h: ReturnType<typeof buildCatalogueHarness>, text: string) =>
    h.db.transaction((tx) => checkText(tx, text, h.now().toISOString()));

  it("covers a flag only when the whole sentence equals an approved, unexpired claim", () => {
    const h = buildCatalogueHarness();
    h.insertApprovedClaim("We are SOC 2 compliant.");
    expect(check(h, "We are SOC 2 compliant.").matches.map((m) => m.covered)).toEqual([true]);
    expect(check(h, "we are soc 2 compliant").matches).toEqual([]);
    expect(check(h, "We are SOC 2 compliant.").matches[0]?.rule).toBe("soc2");
    expect(
      check(h, "We are SOC 2 compliant and always will be.").matches.map((m) => m.covered),
    ).toEqual([false]);
    expect(check(h, "Our SOC 2 report is shared.").matches.map((m) => m.covered)).toEqual([false]);
  });

  it("does not cover with an expired, withdrawn or unapproved claim", () => {
    const h = buildCatalogueHarness();
    h.insertApprovedClaim("We are SOC 2 compliant.", { expiresAt: "2026-11-01T00:00:00.000Z" });
    h.claims.draft(h.actor("drafter"), { text: "We are AI-ready." });
    expect(check(h, "We are SOC 2 compliant.").matches.map((m) => m.covered)).toEqual([false]);
    expect(check(h, "We are AI-ready.").matches.map((m) => m.covered)).toEqual([false]);
  });

  it("returns the same matches as the pure checker over the current phrase list", () => {
    const h = buildCatalogueHarness();
    const text = "We guarantee an SLA and reduced rejections by 40%. See our case study.";
    const viaService = h.claims.lint(h.actor("analyst"), text);
    const pure = lintText(text, { rules: DEFAULT_PHRASE_RULES });
    expect(viaService.listVersion).toBe(1);
    expect(
      viaService.matches.map((m) => ({
        class: m.class,
        rule: m.rule,
        start: m.start,
        end: m.end,
        text: m.text,
      })),
    ).toEqual(pure);
  });

  it("refuses PHI-like text in a lint request and needs claims.read", () => {
    const h = buildCatalogueHarness();
    expect(() => h.claims.lint(h.actor("analyst"), SSN_LIKE)).toThrow();
    expect(() => h.claims.lint({ ...h.actor("analyst"), permissions: [] }, "text")).toThrow(
      /permission/,
    );
  });
});

describe("editing a claim", () => {
  it("allows a draft to change its text and bumps the version, and refuses a stale version", () => {
    const h = buildCatalogueHarness();
    const c = h.claims.draft(h.actor("drafter"), { text: "We review sender feeds." });
    const edited = h.claims.edit(
      h.actor("drafter"),
      c.id,
      { text: "We review sender feeds weekly." },
      c.versionNo,
    );
    expect(edited).toMatchObject({
      text: "We review sender feeds weekly.",
      versionNo: c.versionNo + 1,
    });
    expect(() =>
      h.claims.edit(h.actor("drafter"), c.id, { text: "Another sentence here." }, c.versionNo),
    ).toThrow(/stale|changed/i);
  });

  it("refuses to edit the text of an approved claim", () => {
    const h = buildCatalogueHarness();
    const id = h.insertApprovedClaim("We review sender feeds.");
    expect(() =>
      h.claims.edit(h.actor("drafter"), id, { text: "Something different here." }, 1),
    ).toThrow(/Only a draft can be edited/);
    expect(h.db.transaction((tx) => getClaim(tx, id)?.text)).toBe("We review sender feeds.");
    expect(h.audit("claim.edit.refused")).toHaveLength(1);
  });
});
