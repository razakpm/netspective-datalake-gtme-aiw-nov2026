import { describe, expect, it } from "vitest";
import { artifactChecklist, checkArtifact, DEFAULT_ARTIFACT_KINDS } from "../../src/index.js";

// Feature 007 task T034: which artifacts can be recorded at all (spec FR-014, research R-10). The PHI check
// is the guard's job, not this one.
const RULES = { kinds: [...DEFAULT_ARTIFACT_KINDS], maxBytes: 64 };
const check = (over: Record<string, unknown>) =>
  checkArtifact({ kind: "specification", reference: "Shared drive", ...over }, RULES);

describe("artifact rules", () => {
  it("lists the configured non-PHI kinds", () => {
    expect([...DEFAULT_ARTIFACT_KINDS]).toEqual([
      "specification",
      "timeline",
      "scrubbed_rejection_log",
      "interface_description",
      "field_list",
      "other_non_phi",
    ]);
  });
  it("refuses a kind outside the configured list", () => {
    for (const kind of ["patient_extract", "credentials", ""]) {
      expect(check({ kind })).toEqual({ ok: false, code: "artifact_kind_not_allowed" });
    }
    expect(checkArtifact({ kind: "timeline", reference: "x" }, { ...RULES, kinds: ["x"] })).toEqual(
      { ok: false, code: "artifact_kind_not_allowed" },
    );
  });
  it("needs a reference or content", () => {
    for (const over of [
      { reference: undefined },
      { reference: "  " },
      { reference: "", content: "" },
    ]) {
      expect(check(over)).toEqual({ ok: false, code: "reference_or_content_required" });
    }
    expect(check({ reference: undefined, content: "text" })).toMatchObject({ ok: true });
  });
  it.each(["notes.txt", "map.md", "fields.csv", "spec.json", "run-1.log", "A_b.c.txt"])(
    "accepts the text file name %s",
    (fileName) => {
      expect(check({ fileName, content: "text" })).toMatchObject({ ok: true });
    },
  );
  it.each([
    "spec.pdf",
    "spec.docx",
    "scan.png",
    "archive.zip",
    "noextension",
    ".hidden.txt",
    "../up.txt",
    "a b.txt",
    "NOTES.TXT.exe",
    `${"x".repeat(101)}.txt`,
  ])("refuses the file name %j as not a text file", (fileName) => {
    expect(check({ fileName, content: "text" })).toEqual({
      ok: false,
      code: "binary_not_accepted",
    });
  });
  it.each(["a\u0000b", "\u0007bell", "PDF\u0001", "bad � encoding", "esc\u001b[0m"])(
    "treats content with control characters as binary: %j",
    (content) => {
      expect(check({ content })).toEqual({ ok: false, code: "binary_not_accepted" });
    },
  );
  it("allows tabs and line breaks", () => {
    expect(check({ content: "a\tb\r\nc\n" })).toMatchObject({ ok: true });
  });
  it("counts the size limit in bytes", () => {
    expect(check({ content: "x".repeat(64) })).toMatchObject({ ok: true, sizeBytes: 64 });
    expect(check({ content: "x".repeat(65) })).toEqual({ ok: false, code: "content_too_large" });
    expect(check({ content: "é".repeat(33) })).toEqual({ ok: false, code: "content_too_large" });
  });
  it("gives the extension to store the file under", () => {
    expect(check({ fileName: "fields.CSV".toLowerCase(), content: "a" })).toMatchObject({
      extension: "csv",
    });
    expect(check({ content: "a" })).toMatchObject({ extension: "txt" });
    expect(check({})).toMatchObject({ ok: true, sizeBytes: null, extension: null });
  });
});

describe("the checklist", () => {
  it("shows each configured kind as received, held or not received", () => {
    expect(
      artifactChecklist(
        ["specification", "timeline", "field_list", "scrubbed_rejection_log"],
        [
          { kind: "specification", state: "held" },
          { kind: "specification", state: "released" },
          { kind: "timeline", state: "held" },
          { kind: "field_list", state: "discarded" },
          { kind: "scrubbed_rejection_log", state: "received" },
        ],
      ),
    ).toEqual([
      { kind: "specification", label: "Specification", status: "received" },
      { kind: "timeline", label: "Timeline", status: "held" },
      { kind: "field_list", label: "Field list", status: "not_received" },
      { kind: "scrubbed_rejection_log", label: "Scrubbed rejection log", status: "received" },
    ]);
  });
  it("labels a non-PHI kind plainly", () => {
    expect(artifactChecklist(["other_non_phi"], [])[0]?.label).toBe("Other non-PHI");
  });
});
