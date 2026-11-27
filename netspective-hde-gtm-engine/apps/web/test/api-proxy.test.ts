import { afterEach, describe, expect, it, vi } from "vitest";

// Feature 007: the same-origin proxy passes a download through byte for byte (a PDF is not text).
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn().mockResolvedValue({ idToken: "token" }) }));

const { GET } = await import("../src/app/api/v1/[...path]/route.js");
const context = { params: Promise.resolve({ path: ["workshops", "w1", "output", "pdf"] }) };

vi.stubEnv("API_BASE_URL", "https://api.example.org");
afterEach(() => vi.unstubAllGlobals());

describe("the API proxy", () => {
  it("keeps the bytes and the download headers", async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0xfe, 0x80]);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "application/pdf",
            "content-disposition": 'attachment; filename="page.pdf"',
            "cache-control": "no-store",
            "set-cookie": "x=1",
          },
        }),
      ),
    );
    const out = await GET(
      new Request("http://web.example/api/v1/workshops/w1/output/pdf"),
      context,
    );
    expect(new Uint8Array(await out.arrayBuffer())).toEqual(bytes);
    expect(out.headers.get("content-type")).toBe("application/pdf");
    expect(out.headers.get("content-disposition")).toContain("page.pdf");
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(out.headers.get("set-cookie")).toBeNull();
  });
  it("passes an empty answer through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));
    const out = await GET(new Request("http://web.example/api/v1/x"), context);
    expect(out.status).toBe(204);
  });
});
