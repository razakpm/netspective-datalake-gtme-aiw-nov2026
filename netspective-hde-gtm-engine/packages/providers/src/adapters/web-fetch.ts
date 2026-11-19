import { lookup } from "node:dns/promises";
import { fetchFollowing, type HopFn } from "../follow.js";
import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import type {
  FetchRequest,
  FetchedSource,
  ResearchSourceProvider,
} from "../interfaces/research-source.js";
import { hostIsPublic, type Resolver } from "../ssrf.js";

// Web fetch adapter (feature 004, research R-09), switched on only by an administrator. https only; every
// hop is checked against the approved list and against private, loopback, link-local and metadata
// addresses; redirects are followed manually (max 3); the body is read up to the byte limit; a timeout
// applies. Known limit: DNS is resolved once for the check and again by `fetch`, so a rebinding attack
// between the two is not prevented here (a network egress policy covers that in deployment).

export interface WebFetchOptions {
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
}

const defaultResolve: Resolver = async (host) =>
  (await lookup(host, { all: true })).map((r) => r.address);

async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; sizeBytes: number }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const text = await response.text();
    return { text, sizeBytes: Buffer.byteLength(text) };
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      break;
    }
  }
  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return { text: buffer.toString("utf8"), sizeBytes: size };
}

export class WebFetchSource implements ResearchSourceProvider {
  readonly name = "web-fetch";
  private readonly fetchImpl: typeof fetch;
  private readonly resolve: Resolver;

  constructor(options: WebFetchOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.resolve = options.resolve ?? defaultResolve;
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
      let url: URL;
      try {
        url = new URL(address);
      } catch {
        return fail("invalid_address");
      }
      if (url.protocol !== "https:") return fail("invalid_address");
      if (!(await hostIsPublic(url.hostname, this.resolve))) return fail("blocked_address");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), request.timeoutMs);
      try {
        const response = await this.fetchImpl(address, {
          redirect: "manual",
          signal: controller.signal,
        });
        const { text, sizeBytes } = await readLimited(response, request.maxBytes + 1);
        return ok({
          status: response.status,
          contentType: response.headers.get("content-type") ?? "",
          location: response.headers.get("location") ?? undefined,
          text,
          sizeBytes,
        });
      } catch (error) {
        return fail(
          error instanceof Error && error.name === "AbortError" ? "timeout" : "unreachable",
          true,
        );
      } finally {
        clearTimeout(timer);
      }
    };
    return fetchFollowing(request, hop);
  }
}
