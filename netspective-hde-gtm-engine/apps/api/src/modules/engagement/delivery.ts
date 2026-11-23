import type { FileStorageProvider } from "@gtm/providers";

// Register delivery (feature 006, spec FR-020, research R-10): the register is delivered as a signed link
// that expires, shown on the confirmation page. No email is sent. The register file is supplied by the
// business and is not in the repository: a missing file is a recorded failed delivery, never an error.

export interface DeliverySettings {
  registerFileKey: string;
  linkTtlHours: number;
}

export type Delivery =
  | { delivered: true; token: string; expiresAt: Date }
  | { delivered: false; failure: "file_missing"; token: null; expiresAt: null };

export const DOWNLOAD_PATH = "/api/v1/public/downloads/";

export class DeliveryService {
  constructor(
    private readonly files: FileStorageProvider,
    private readonly settings: DeliverySettings,
  ) {}

  /** Check the file exists and sign a link that lasts `linkTtlHours`. */
  async prepare(now: Date): Promise<Delivery> {
    const file = await this.files.get(this.settings.registerFileKey);
    if (!file) return { delivered: false, failure: "file_missing", token: null, expiresAt: null };
    file.stream.destroy();
    const expiresAt = new Date(now.getTime() + this.settings.linkTtlHours * 3_600_000);
    return {
      delivered: true,
      token: this.files.sign(this.settings.registerFileKey, expiresAt),
      expiresAt,
    };
  }

  /** The same link again for a stored expiry (used when a repeated submission is recognised). */
  relink(expiresAt: Date): string {
    return this.files.sign(this.settings.registerFileKey, expiresAt);
  }

  /** Resolve a link: the file stream while it is valid, otherwise why not. */
  async open(token: string, now: Date) {
    const v = this.files.verify(token, now);
    if (!v.ok)
      return {
        ok: false as const,
        code: v.reason === "expired" ? ("expired" as const) : ("invalid" as const),
      };
    if (v.key !== this.settings.registerFileKey)
      return { ok: false as const, code: "invalid" as const };
    const file = await this.files.get(v.key);
    if (!file) return { ok: false as const, code: "missing" as const };
    return { ok: true as const, file, key: v.key };
  }
}
