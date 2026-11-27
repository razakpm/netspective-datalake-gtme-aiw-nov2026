import { chromium } from "playwright-core";
import type { PdfRenderer, RenderedPdf } from "../interfaces/pdf-renderer.js";
import { fail, ok, type ProviderResult } from "../interfaces/result.js";

// A4 PDF through Chromium (feature 007, research R-12, ADR-021). Needs a Chromium binary in the image. The
// page runs no script and may fetch nothing; the browser is closed after every render.

export interface PlaywrightPdfOptions {
  /** Defaults to the browser Playwright installed. */
  executablePath?: string | undefined;
  timeoutMs?: number | undefined;
}

/** Page objects in the file; the page tree's own entry is "/Pages" and is not counted. */
const countPages = (bytes: Buffer): number =>
  bytes.toString("latin1").match(/\/Type\s*\/Page(?![a-zA-Z])/g)?.length ?? 0;

export class PlaywrightPdfRenderer implements PdfRenderer {
  readonly name = "playwright-pdf";
  constructor(private readonly options: PlaywrightPdfOptions = {}) {}

  async render(html: string): Promise<ProviderResult<RenderedPdf>> {
    const timeout = this.options.timeoutMs ?? 30_000;
    try {
      const browser = await chromium.launch({
        timeout,
        ...(this.options.executablePath ? { executablePath: this.options.executablePath } : {}),
      });
      try {
        const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
        await context.route("**/*", (route) => route.abort());
        const page = await context.newPage();
        await page.setContent(html, { waitUntil: "domcontentloaded", timeout });
        const bytes = await page.pdf({ format: "A4", printBackground: true });
        const pages = countPages(bytes);
        return pages > 0 ? ok({ bytes, pages }) : fail("render_failed", true);
      } finally {
        await browser.close();
      }
    } catch {
      // The message can hold paths of the host, so only a code leaves.
      return fail("render_failed", true);
    }
  }
}
