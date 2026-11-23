import { Readable } from "node:stream";
import {
  signToken,
  verifyToken,
  type FileStorageProvider,
  type StoredFile,
  type VerifiedToken,
} from "../interfaces/file-storage.js";

// In-memory file storage for tests (feature 006). The register in tests is a synthetic file.
export class FakeFileStorage implements FileStorageProvider {
  readonly name = "fake-file-storage";
  private readonly files = new Map<string, { bytes: Buffer; contentType: string }>();

  constructor(private readonly secret: string) {}

  put(key: string, bytes: Buffer, contentType = "application/octet-stream"): void {
    this.files.set(key, { bytes, contentType });
  }
  remove(key: string): void {
    this.files.delete(key);
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
