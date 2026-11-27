import { Readable } from "node:stream";
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

// In-memory file storage for tests (feature 006). The register in tests is a synthetic file.
export class FakeFileStorage implements FileStorageProvider {
  readonly name = "fake-file-storage";
  private readonly files = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor(private readonly secret: string) {}

  private failures = new Set<"put" | "delete">();

  /** Test control: the next call of that kind fails. */
  failNext(operation: "put" | "delete"): void {
    this.failures.add(operation);
  }
  /** Test view: the keys currently stored. */
  keys(): string[] {
    return [...this.files.keys()].sort();
  }

  async put(
    key: string,
    bytes: Buffer,
    contentType: string,
    options: PutOptions = {},
  ): Promise<PutResult> {
    if (!isSafeFileKey(key)) return { ok: false, reason: "unsafe_key" };
    if (this.failures.delete("put")) return { ok: false, reason: "write_failed" };
    if (this.files.has(key) && !options.overwrite) return { ok: false, reason: "exists" };
    this.files.set(key, { bytes: Buffer.from(bytes), contentType });
    return { ok: true };
  }
  async delete(key: string): Promise<boolean> {
    if (!isSafeFileKey(key)) return false;
    if (this.failures.delete("delete")) return false;
    this.files.delete(key);
    return true;
  }

  async get(key: string): Promise<StoredFile | null> {
    const f = this.files.get(key);
    if (!f) return null;
    return { stream: Readable.from([f.bytes]), size: f.bytes.length, contentType: f.contentType };
  }
  sign(key: string, expiresAt: Date): string {
    return signToken(this.secret, key, expiresAt);
  }
  verify(token: string, now: Date): VerifiedToken {
    return verifyToken(this.secret, token, now);
  }
}
