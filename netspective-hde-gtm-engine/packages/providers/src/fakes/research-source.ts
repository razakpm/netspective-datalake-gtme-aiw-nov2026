import { fetchFollowing, type HopFn } from "../follow.js";
import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import type {
  FetchRequest,
  FetchedSource,
  ResearchSourceProvider,
} from "../interfaces/research-source.js";

// Deterministic fake research source (no network). Pages are scripted by address.

export interface FakePage {
  address: string;
  status: number;
  contentType: string;
  text?: string;
  textRepeat?: { unit: string; times: number };
  redirectTo?: string;
}

export class FakeResearchSource implements ResearchSourceProvider {
  readonly name = "fake";
  readonly fetched: string[] = [];
  private readonly pages = new Map<string, FakePage>();

  constructor(pages: readonly FakePage[]) {
    for (const p of pages) this.pages.set(p.address, p);
  }

  async fetch(request: FetchRequest): Promise<ProviderResult<FetchedSource>> {
    if (request.capturedText !== undefined) {
      const sizeBytes = Buffer.byteLength(request.capturedText);
      const truncated = sizeBytes > request.maxBytes;
      return ok({
        address: request.address,
        finalAddress: request.address,
        status: 200,
        contentType: "text/plain",
        text: truncated
          ? Buffer.from(request.capturedText).subarray(0, request.maxBytes).toString("utf8")
          : request.capturedText,
        sizeBytes: Math.min(sizeBytes, request.maxBytes + 1),
        truncated,
      });
    }
    const hop: HopFn = async (address) => {
      this.fetched.push(address);
      const page = this.pages.get(address);
      if (!page) return fail("unreachable", false);
      const text = page.textRepeat
        ? page.textRepeat.unit.repeat(page.textRepeat.times)
        : (page.text ?? "");
      return ok({
        status: page.status,
        contentType: page.contentType,
        location: page.redirectTo,
        text,
        sizeBytes: Buffer.byteLength(text),
      });
    };
    return fetchFollowing(request, hop);
  }
}
