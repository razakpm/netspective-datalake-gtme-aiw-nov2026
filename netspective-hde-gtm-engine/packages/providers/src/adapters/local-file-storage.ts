import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { extname, join } from "node:path";
import {
  signToken,
  verifyToken,
  type FileStorageProvider,
  type StoredFile,
  type VerifiedToken,
} from "../interfaces/file-storage.js";

// Local-disk file storage (feature 006, research R-10). A key is a plain file name inside the directory:
// no path separators, no leading dot, no traversal, and a symbolic link is never followed. The directory
// and the signing key come from configuration; the register file is supplied by the business.

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
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
    if (!SAFE_KEY.test(key) || key.includes("..")) return null;
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
  sign(key: string, expiresAt: Date): string {
    return signToken(this.secret, key, expiresAt);
  }
  verify(token: string, now: Date): VerifiedToken {
    return verifyToken(this.secret, token, now);
  }
}
