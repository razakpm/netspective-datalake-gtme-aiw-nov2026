import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import type {
  FetchRequest,
  FetchedSource,
  ResearchSourceProvider,
} from "../interfaces/research-source.js";

// Manual URL capture (feature 004, research R-09): the analyst supplies the address and the page text, so
// no network call is ever made. Used when the web fetch route is switched off (the default).
export class ManualCaptureSource implements ResearchSourceProvider {
  readonly name = "manual-capture";

  async fetch(request: FetchRequest): Promise<ProviderResult<FetchedSource>> {
    if (request.capturedText === undefined) return fail("unreachable", false);
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
}
