import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

describe("LocalFileStorage write side (feature 007)", () => {
  const bytes = Buffer.from("synthetic upload");

  it("stores a file and reads it back, creating the directory if it is absent", async () => {
    const dir = join(mkdtempSync(join(tmpdir(), "gtm-files-")), "not-yet-there");
    const files = new LocalFileStorage(dir, KEY);
    expect(await files.put("workshop-w1-specification-a1.txt", bytes, "text/plain")).toEqual({
      ok: true,
    });
    const got = await files.get("workshop-w1-specification-a1.txt");
    expect(got?.size).toBe(bytes.length);
    expect(await read(got)).toBe("synthetic upload");
    expect(readdirSync(dir)).toEqual(["workshop-w1-specification-a1.txt"]);
  });
  it("refuses to overwrite unless asked", async () => {
    const { files } = store();
    expect(await files.put("notes.txt", bytes, "text/plain")).toEqual({
      ok: false,
      reason: "exists",
    });
    expect(await read(await files.get("notes.txt"))).toBe("plain");
    expect(await files.put("notes.txt", bytes, "text/plain", { overwrite: true })).toEqual({
      ok: true,
    });
    expect(await read(await files.get("notes.txt"))).toBe("synthetic upload");
  });
  it.each(["../secret", "..", "/etc/passwd", "sub/dir.pdf", "a\\b", "", ".hidden", "x\0y"])(
    "refuses to write or delete the unsafe key %j",
    async (key) => {
      const { files } = store();
      expect(await files.put(key, bytes, "text/plain")).toEqual({
        ok: false,
        reason: "unsafe_key",
      });
      expect(await files.delete(key)).toBe(false);
    },
  );
  it("does not write through or delete a symbolic link", async () => {
    const { dir, files } = store();
    const target = join(mkdtempSync(join(tmpdir(), "gtm-outside-")), "outside.txt");
    writeFileSync(target, "outside");
    symlinkSync(target, join(dir, "link.txt"));
    expect(await files.put("link.txt", bytes, "text/plain")).toEqual({
      ok: false,
      reason: "exists",
    });
    expect(await files.delete("link.txt")).toBe(false);
    expect(await files.put("link.txt", bytes, "text/plain", { overwrite: true })).toEqual({
      ok: true,
    });
    expect(readFileSync(target, "utf8")).toBe("outside");
  });
  it("leaves no readable or temporary file when a write fails", async () => {
    const { dir, files } = store();
    mkdirSync(join(dir, "taken.txt"));
    const before = readdirSync(dir).sort();
    expect(await files.put("taken.txt", bytes, "text/plain", { overwrite: true })).toEqual({
      ok: false,
      reason: "write_failed",
    });
    expect(await files.get("taken.txt")).toBeNull();
    expect(readdirSync(dir).sort()).toEqual(before);
  });
  it("deletes a file and treats deleting a missing one as done", async () => {
    const { files } = store();
    expect(await files.delete("notes.txt")).toBe(true);
    expect(await files.get("notes.txt")).toBeNull();
    expect(await files.delete("notes.txt")).toBe(true);
  });
});
