import { createHash } from "node:crypto";
import type { PdfRenderer, RenderedPdf } from "../interfaces/pdf-renderer.js";
import { fail, ok, type ProviderResult } from "../interfaces/result.js";

// Deterministic fake renderer for tests and development (feature 007). It is not a real PDF: a page count
// is estimated from the length of the visible text.

const CHARS_PER_PAGE = 3500;
// Headings and the document's own markup are not counted.
const visibleText = (html: string): string =>
  html
    .replace(/<(style|title)>.*?<\/\1>/gs, "")
    .replace(/<h2>.*?<\/h2>/gs, "")
    .replace(/<[^>]*>/g, "");

export class FakePdfRenderer implements PdfRenderer {
  readonly name = "fake-pdf";
  /** Every page given, for assertions. */
  readonly pages: string[] = [];
  private failing = false;
  private forced: number | undefined;

  failNext(): void {
    this.failing = true;
  }
  /** The next render reports this many pages. */
  forcePages(count: number): void {
    this.forced = count;
  }

  async render(html: string): Promise<ProviderResult<RenderedPdf>> {
    if (this.failing) {
      this.failing = false;
      return fail("render_failed", true);
    }
    this.pages.push(html);
    const pages = this.forced ?? Math.max(1, Math.ceil(visibleText(html).length / CHARS_PER_PAGE));
    this.forced = undefined;
    const digest = createHash("sha256").update(html).digest("hex");
    return ok({ bytes: Buffer.from(`%PDF-1.4\n% fake ${digest}\n%%EOF\n`), pages });
  }
}
