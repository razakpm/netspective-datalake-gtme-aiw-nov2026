import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LocalFileStorage } from "../src/adapters/local-file-storage.js";

const KEY = "k".repeat(32);
const at = new Date("2026-11-23T10:00:00.000Z");

function store() {
  const dir = mkdtempSync(join(tmpdir(), "gtm-files-"));
  writeFileSync(join(dir, "register.pdf"), "synthetic register");
  writeFileSync(join(dir, "notes.txt"), "plain");
  return { dir, files: new LocalFileStorage(dir, KEY) };
}
const read = async (r: Awaited<ReturnType<LocalFileStorage["get"]>>) => {
  const chunks: Buffer[] = [];
  for await (const c of r!.stream) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks).toString();
};

describe("LocalFileStorage", () => {
  it("reads a file under the directory with its size and a content type from the extension", async () => {
    const { files } = store();
    const got = await files.get("register.pdf");
    expect(got).toMatchObject({ size: 18, contentType: "application/pdf" });
    expect(await read(got)).toBe("synthetic register");
    expect((await files.get("notes.txt"))?.contentType).toBe("text/plain");
  });
  it("returns null for a missing file", async () => {
    expect(await store().files.get("absent.pdf")).toBeNull();
  });
  it.each([
    "../secret",
    "..",
    "a/../../b",
    "/etc/passwd",
    "sub/dir.pdf",
    "a\\b",
    "",
    ".hidden",
    "x\0y",
  ])("refuses the unsafe key %j", async (key) => {
    expect(await store().files.get(key)).toBeNull();
  });
  it("does not follow a symbolic link out of the directory", async () => {
    const { dir, files } = store();
    const { symlinkSync } = await import("node:fs");
    symlinkSync("/etc/hostname", join(dir, "link.txt"));
    expect(await files.get("link.txt")).toBeNull();
  });
  it("signs and verifies with the signing key, and refuses an expired or foreign token", () => {
    const { files } = store();
    const token = files.sign("register.pdf", new Date(at.getTime() + 3_600_000));
    expect(files.verify(token, at)).toMatchObject({ ok: true, key: "register.pdf" });
    expect(files.verify(token, new Date(at.getTime() + 7_200_000))).toEqual({
      ok: false,
      reason: "expired",
    });
    expect(new LocalFileStorage("/tmp", "j".repeat(32)).verify(token, at)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });
});
