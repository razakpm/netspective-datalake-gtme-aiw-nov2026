import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "../src/app/api/public/[...path]/route.js";

// Task T068: the unauthenticated proxy forwards only to the public group of the API.
const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/") }) });
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  process.env["API_BASE_URL"] = "http://api.example.test";
  fetchMock = vi.fn(
    async () =>
      new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json", "set-cookie": "a=b" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env["API_BASE_URL"];
});

describe("public proxy", () => {
  it("forwards the form, a request and a download to the public group, and nothing else", async () => {
    const form = await GET(
      new Request("http://web.test/api/public/offers/pilot-input-trace-workshop/form"),
      ctx("offers/pilot-input-trace-workshop/form"),
    );
    expect(form.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://api.example.test/api/v1/public/offers/pilot-input-trace-workshop/form",
    );
    const post = await POST(
      new Request("http://web.test/api/public/offers/x/requests", {
        method: "POST",
        body: '{"a":1}',
      }),
      ctx("offers/x/requests"),
    );
    expect(post.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "http://api.example.test/api/v1/public/offers/x/requests",
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "POST", body: '{"a":1}' });
    await GET(
      new Request("http://web.test/api/public/downloads/abc.def"),
      ctx("downloads/abc.def"),
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "http://api.example.test/api/v1/public/downloads/abc.def",
    );
  });

  it.each([
    "users",
    "offers/x/form/extra",
    "../users",
    "auth/me",
    "offers/x/review",
    "offers//form",
    "downloads/a/b",
    "offers/X Y/form",
  ])("answers 404 for %s without calling the API", async (path) => {
    const res = await GET(new Request("http://web.test/x"), ctx(path));
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the wrong method for a path", async () => {
    expect(
      (
        await POST(
          new Request("http://web.test/x", { method: "POST", body: "{}" }),
          ctx("offers/x/form"),
        )
      ).status,
    ).toBe(405);
    expect((await GET(new Request("http://web.test/x"), ctx("offers/x/requests"))).status).toBe(
      405,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes on neither cookies nor an authorisation header, and drops the API's cookies", async () => {
    const res = await GET(
      new Request("http://web.test/x", {
        headers: {
          cookie: "session=secret",
          authorization: "Bearer secret",
          "idempotency-key": "k".repeat(10),
        },
      }),
      ctx("offers/x/form"),
    );
    const sent = (fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> }).headers;
    expect(Object.keys(sent).map((h) => h.toLowerCase())).not.toEqual(
      expect.arrayContaining(["cookie", "authorization"]),
    );
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("returns the API's status and file headers, including a 410 for an expired link", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("gone", {
        status: 410,
        headers: { "content-type": "application/problem+json" },
      }),
    );
    const gone = await GET(new Request("http://web.test/x"), ctx("downloads/old.token"));
    expect(gone.status).toBe(410);
    fetchMock.mockResolvedValueOnce(
      new Response("file", {
        status: 200,
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="r.pdf"',
        },
      }),
    );
    const file = await GET(new Request("http://web.test/x"), ctx("downloads/good.token"));
    expect(file.headers.get("content-disposition")).toContain("attachment");
    expect(await file.text()).toBe("file");
  });
});
