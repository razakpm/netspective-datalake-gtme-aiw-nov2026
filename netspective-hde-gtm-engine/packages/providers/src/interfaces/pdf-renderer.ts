import type { ProviderResult } from "./result.js";

// PDF renderer interface (feature 007, research R-12). The input is a self-contained page built from escaped
// text; the result says how many pages it made, so a caller can require exactly one.

export interface RenderedPdf {
  bytes: Buffer;
  pages: number;
}

export interface PdfRenderer {
  readonly name: string;
  render(html: string): Promise<ProviderResult<RenderedPdf>>;
}
