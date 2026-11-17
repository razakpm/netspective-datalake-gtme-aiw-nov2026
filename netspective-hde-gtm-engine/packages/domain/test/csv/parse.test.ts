import { describe, expect, it } from "vitest";
import { decodeUtf8, parseCsv } from "../../src/index.js";

const spec = { required: ["name", "type"], optional: ["notes"] };
const limits = { maxBytes: 10_000, maxRows: 5 };

describe("parseCsv", () => {
  it("parses quoted fields, escaped quotes, CRLF, BOM and numbers rows from 1", () => {
    const text = '﻿name,type,notes\r\n"Acme, Inc",health_system,"says ""hi"""\r\nBeta,payer,\r\n';
    const r = parseCsv(text, spec, limits);
    expect(r).toEqual({
      ok: true,
      rows: [
        { rowNumber: 1, values: { name: "Acme, Inc", type: "health_system", notes: 'says "hi"' } },
        { rowNumber: 2, values: { name: "Beta", type: "payer", notes: "" } },
      ],
    });
  });
  it("keeps newlines inside quotes", () => {
    const r = parseCsv('name,type\n"a\nb",x\n', spec, limits);
    expect(r.ok && r.rows[0]?.values.name).toBe("a\nb");
  });
  it("rejects the whole file for header, size, row, quote and empty problems", () => {
    expect(parseCsv("name\nA\n", spec, limits)).toMatchObject({
      ok: false,
      code: "missing_required_header",
      headers: ["type"],
    });
    expect(parseCsv("name,type,extra\nA,b,c\n", spec, limits)).toMatchObject({
      ok: false,
      code: "unknown_header",
      headers: ["extra"],
    });
    expect(parseCsv("name,name,type\n", spec, limits)).toMatchObject({
      ok: false,
      code: "duplicate_header",
    });
    expect(parseCsv("name,type\n" + "a,b\n".repeat(6), spec, limits)).toMatchObject({
      ok: false,
      code: "too_many_rows",
    });
    expect(
      parseCsv("name,type\n" + "a,b\n".repeat(5), spec, { ...limits, maxBytes: 20 }),
    ).toMatchObject({ ok: false, code: "file_too_large" });
    expect(parseCsv('name,type\n"open,b\n', spec, limits)).toMatchObject({
      ok: false,
      code: "unterminated_quote",
    });
    expect(parseCsv("", spec, limits)).toMatchObject({ ok: false, code: "empty_file" });
  });
  it("marks rows with the wrong cell count without failing the file", () => {
    const r = parseCsv("name,type\nA,b\nbroken\nC,d\n", spec, limits);
    expect(r.ok && r.rows.map((x) => x.error)).toEqual([
      undefined,
      "column_count_mismatch",
      undefined,
    ]);
  });
  it("never puts cell content in a failure", () => {
    const r = parseCsv("name,type,SECRET-CANARY!\nA,b,c\n", spec, limits);
    expect(JSON.stringify(r)).not.toContain("SECRET-CANARY");
  });
  it("round-trips arbitrary quoted cells", () => {
    for (const cell of ["plain", "with,comma", 'with "quote"', "multi\nline", " spaced "]) {
      const encoded = `"${cell.replace(/"/g, '""')}"`;
      const r = parseCsv(`name,type\n${encoded},x\n`, spec, limits);
      expect(r.ok && r.rows[0]?.values.name).toBe(cell.trim());
    }
  });
  it("detects invalid UTF-8", () => {
    expect(decodeUtf8(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
    expect(decodeUtf8(new TextEncoder().encode("ok"))).toBe("ok");
  });
});
