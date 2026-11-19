import { describe, expect, it } from "vitest";
import { WebFetchSource, hostIsPublic, isPublicAddress } from "../src/index.js";

// Task T023: the fetch adapter and its address guard.
const base = { maxBytes: 1_000_000, timeoutMs: 500 };
const publicResolve = async () => ["93.184.216.34"];
const respond = (map: Record<string, () => Response>) =>
  (async (url: string) =>
    map[url] ? map[url]!() : new Response("", { status: 404 })) as unknown as typeof fetch;
const html = (text: string) => () =>
  new Response(text, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

describe("address guard", () => {
  it("blocks private, loopback, link-local, metadata, carrier-grade NAT and multicast addresses", () => {
    for (const ip of [
      "10.0.0.1",
      "127.0.0.1",
      "172.16.0.5",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd12::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "2606:2800:220:1:248:1893:25c8:1946",
    ])
      expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress("not an ip")).toBe(false);
  });
  it("requires every resolved address to be public and treats resolver failure as blocked", async () => {
    expect(await hostIsPublic("a.example", async () => ["93.184.216.34", "10.0.0.1"])).toBe(false);
    expect(await hostIsPublic("a.example", async () => [])).toBe(false);
    expect(
      await hostIsPublic("a.example", async () => {
        throw new Error("nxdomain");
      }),
    ).toBe(false);
    expect(await hostIsPublic("a.example", publicResolve)).toBe(true);
    expect(await hostIsPublic("127.0.0.1", publicResolve)).toBe(false);
  });
});

describe("WebFetchSource", () => {
  it("fetches https pages and reports the content type without parameters", async () => {
    const source = new WebFetchSource({
      resolve: publicResolve,
      fetchImpl: respond({ "https://a.example/p": html("hello") }),
    });
    const r = await source.fetch({
      ...base,
      address: "https://a.example/p",
      isApproved: () => true,
    });
    expect(r.ok && r.value).toMatchObject({
      text: "hello",
      contentType: "text/html",
      finalAddress: "https://a.example/p",
      truncated: false,
    });
  });
  it("refuses http, private hosts and hosts that resolve to private addresses without fetching", async () => {
    let fetched = 0;
    const counting = (async () => {
      fetched++;
      return new Response("x");
    }) as unknown as typeof fetch;
    const source = new WebFetchSource({
      resolve: async (h) => (h === "internal.example" ? ["10.1.1.1"] : ["93.184.216.34"]),
      fetchImpl: counting,
    });
    const call = (address: string) => source.fetch({ ...base, address, isApproved: () => true });
    expect(await call("http://a.example/")).toEqual({
      ok: false,
      error: { code: "invalid_address", retryable: false },
    });
    expect(await call("https://internal.example/")).toEqual({
      ok: false,
      error: { code: "blocked_address", retryable: false },
    });
    expect(await call("https://127.0.0.1/")).toEqual({
      ok: false,
      error: { code: "blocked_address", retryable: false },
    });
    expect(await call("not a url")).toEqual({
      ok: false,
      error: { code: "invalid_address", retryable: false },
    });
    expect(fetched).toBe(0);
  });
  it("re-checks approval at every redirect hop, stops after three redirects and checks the next hop's host", async () => {
    const redirect = (to: string) => () =>
      new Response("", { status: 302, headers: { location: to } });
    const source = new WebFetchSource({
      resolve: async (h) => (h === "internal.example" ? ["10.0.0.9"] : ["93.184.216.34"]),
      fetchImpl: respond({
        "https://a.example/1": redirect("https://a.example/2"),
        "https://a.example/2": html("final"),
        "https://a.example/x": redirect("https://evil.example/"),
        "https://a.example/to-internal": redirect("https://internal.example/"),
        "https://a.example/l1": redirect("https://a.example/l2"),
        "https://a.example/l2": redirect("https://a.example/l3"),
        "https://a.example/l3": redirect("https://a.example/l4"),
        "https://a.example/l4": redirect("https://a.example/l5"),
      }),
    });
    const approved = (a: string) => !a.includes("evil.example");
    const ok1 = await source.fetch({
      ...base,
      address: "https://a.example/1",
      isApproved: approved,
    });
    expect(ok1.ok && ok1.value.finalAddress).toBe("https://a.example/2");
    expect(
      await source.fetch({ ...base, address: "https://a.example/x", isApproved: approved }),
    ).toEqual({ ok: false, error: { code: "redirect_not_approved", retryable: false } });
    expect(
      await source.fetch({
        ...base,
        address: "https://a.example/to-internal",
        isApproved: () => true,
      }),
    ).toEqual({ ok: false, error: { code: "blocked_address", retryable: false } });
    expect(
      await source.fetch({ ...base, address: "https://a.example/l1", isApproved: () => true }),
    ).toEqual({ ok: false, error: { code: "too_many_redirects", retryable: false } });
  });
  it("accepts only html, plain text and json; maps 5xx to a retryable error; truncates large bodies", async () => {
    const source = new WebFetchSource({
      resolve: publicResolve,
      fetchImpl: respond({
        "https://a.example/pdf": () =>
          new Response("x", { status: 200, headers: { "content-type": "application/pdf" } }),
        "https://a.example/down": () => new Response("", { status: 503 }),
        "https://a.example/big": html("x".repeat(5000)),
        "https://a.example/json": () =>
          new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      }),
    });
    const f = (address: string, maxBytes = 1_000_000) =>
      source.fetch({ ...base, maxBytes, address, isApproved: () => true });
    expect(await f("https://a.example/pdf")).toEqual({
      ok: false,
      error: { code: "unsupported_content_type", retryable: false },
    });
    expect(await f("https://a.example/down")).toEqual({
      ok: false,
      error: { code: "unreachable", retryable: true },
    });
    const big = await f("https://a.example/big", 1000);
    expect(big.ok && big.value.truncated).toBe(true);
    expect(big.ok && Buffer.byteLength(big.value.text)).toBeLessThanOrEqual(1000);
    expect((await f("https://a.example/json")).ok).toBe(true);
  });
  it("times out a slow response with a retryable error", async () => {
    const slow = ((_: string, init: RequestInit) =>
      new Promise((_, reject) => {
        init.signal!.addEventListener("abort", () =>
          reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
        );
      })) as unknown as typeof fetch;
    const source = new WebFetchSource({ resolve: publicResolve, fetchImpl: slow });
    expect(
      await source.fetch({
        maxBytes: 100,
        timeoutMs: 20,
        address: "https://a.example/slow",
        isApproved: () => true,
      }),
    ).toEqual({ ok: false, error: { code: "timeout", retryable: true } });
  });
});
