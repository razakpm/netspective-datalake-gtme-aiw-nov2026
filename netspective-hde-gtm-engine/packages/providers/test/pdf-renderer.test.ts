import { renderOutputHtml } from "@gtm/domain";
import { describe, expect, it } from "vitest";
import { PlaywrightPdfRenderer } from "../src/adapters/playwright-pdf.js";
import { FakePdfRenderer } from "../src/fakes/pdf-renderer.js";

// Feature 007 task T054 (research R-12). The real renderer needs a Chromium binary, so it runs only when
// asked: PDF_RENDERER_REAL=1.
const page = (summary: string) =>
  renderOutputHtml({
    title: "Workshop findings",
    organisation: "Northvale HIE",
    offerName: "Friction Map",
    date: "2026-11-24",
    summary,
    findings: "1. Reviews wait.",
    unknowns: "Unknown: repeat rate.",
    nextStep: "Collect logs.",
    inScope: ["Delays"],
    outOfScope: ["Fixes"],
  });

describe("the fake renderer", () => {
  it("returns the same bytes for the same page and counts pages from the text", async () => {
    const renderer = new FakePdfRenderer();
    const first = await renderer.render(page("Short."));
    const second = await renderer.render(page("Short."));
    expect(first).toEqual(second);
    if (!first.ok) throw new Error("failed");
    expect(first.value.pages).toBe(1);
    expect(first.value.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(await renderer.render(page("word ".repeat(1500)))).toMatchObject({
      ok: true,
      value: { pages: 3 },
    });
  });
  it("can be told to fail", async () => {
    const renderer = new FakePdfRenderer();
    renderer.failNext();
    expect(await renderer.render(page("x"))).toMatchObject({
      ok: false,
      error: { code: "render_failed" },
    });
    expect((await renderer.render(page("x"))).ok).toBe(true);
  });
});

describe.runIf(process.env["PDF_RENDERER_REAL"] === "1")("the Playwright renderer", () => {
  it("makes one page for a normal output and more for an over-long one", async () => {
    const renderer = new PlaywrightPdfRenderer();
    const normal = await renderer.render(page("A short summary. ".repeat(20)));
    if (!normal.ok) throw new Error(normal.error.code);
    expect(normal.value.pages).toBe(1);
    expect(normal.value.bytes.subarray(0, 5).toString()).toBe("%PDF-");
    const long = await renderer.render(page("A long line of words. ".repeat(400)));
    expect(long).toMatchObject({ ok: true, value: { pages: 2 } });
  }, 60_000);
  it("runs no script and fetches nothing", async () => {
    const renderer = new PlaywrightPdfRenderer();
    const html = `<!doctype html><body><p id="p">before</p><img src="https://evil.example/x.png"><script>document.body.innerHTML = "<p>word </p>".repeat(2000)</script></body>`;
    expect(await renderer.render(html)).toMatchObject({ ok: true, value: { pages: 1 } });
  }, 60_000);
});

describe("the Playwright renderer without a browser", () => {
  it("returns a typed failure when the browser cannot start", async () => {
    const renderer = new PlaywrightPdfRenderer({ executablePath: "/nonexistent/chromium" });
    expect(await renderer.render(page("x"))).toMatchObject({
      ok: false,
      error: { code: "render_failed" },
    });
  }, 30_000);
});
