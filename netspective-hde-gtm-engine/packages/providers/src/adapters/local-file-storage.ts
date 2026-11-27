import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { link, lstat, mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  isSafeFileKey,
  signToken,
  verifyToken,
  type FileStorageProvider,
  type PutOptions,
  type PutResult,
  type StoredFile,
  type VerifiedToken,
} from "../interfaces/file-storage.js";

// Local-disk file storage (feature 006, research R-10). A key is a plain file name inside the directory:
// no path separators, no leading dot, no traversal, and a symbolic link is never followed. The directory
// and the signing key come from configuration; the register file is supplied by the business.

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException).code;
const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
};

export class LocalFileStorage implements FileStorageProvider {
  readonly name = "local-file-storage";

  constructor(
    private readonly dir: string,
    private readonly secret: string,
  ) {}

  async get(key: string): Promise<StoredFile | null> {
    if (!isSafeFileKey(key)) return null;
    const path = join(this.dir, key);
    try {
      const info = await lstat(path);
      if (!info.isFile()) return null;
      return {
        stream: createReadStream(path),
        size: info.size,
        contentType: TYPES[extname(key).toLowerCase()] ?? "application/octet-stream",
      };
    } catch {
      return null;
    }
  }
  /**
   * Writes to a temporary file first (its leading dot makes it unreadable through `get`), then puts it in
   * place in one step. Without `overwrite` the step is a hard link, which refuses an existing name.
   */
  async put(
    key: string,
    bytes: Buffer,
    _contentType: string,
    options: PutOptions = {},
  ): Promise<PutResult> {
    if (!isSafeFileKey(key)) return { ok: false, reason: "unsafe_key" };
    const path = join(this.dir, key);
    const temporary = join(this.dir, `.tmp-${randomBytes(12).toString("hex")}`);
    try {
      await mkdir(this.dir, { recursive: true });
      await writeFile(temporary, bytes, { flag: "wx", mode: 0o600 });
      if (options.overwrite) await rename(temporary, path);
      else await link(temporary, path);
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: errorCode(error) === "EEXIST" ? "exists" : "write_failed" };
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!isSafeFileKey(key)) return false;
    const path = join(this.dir, key);
    try {
      const info = await lstat(path);
      if (!info.isFile()) return false;
      await unlink(path);
      return true;
    } catch (error) {
      return errorCode(error) === "ENOENT";
    }
  }
  sign(key: string, expiresAt: Date): string {
    return signToken(this.secret, key, expiresAt);
  }
  verify(token: string, now: Date): VerifiedToken {
    return verifyToken(this.secret, token, now);
  }
}
