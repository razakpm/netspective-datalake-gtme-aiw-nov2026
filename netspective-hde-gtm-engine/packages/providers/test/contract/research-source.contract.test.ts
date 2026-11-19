import { describe } from "vitest";
import { FakeResearchSource, WebFetchSource } from "../../src/index.js";
import { sourceContract } from "./suite.js";

const page = (address: string, extra: object = {}) => ({
  address,
  status: 200,
  contentType: "text/html",
  text: "page text here",
  ...extra,
});

describe("ResearchSourceProvider contract", () => {
  sourceContract("fake", () => ({
    provider: new FakeResearchSource([
      page("https://ok.example/p"),
      {
        address: "https://r.example/go",
        status: 302,
        contentType: "text/html",
        text: "",
        redirectTo: "https://elsewhere.example/",
      },
    ]),
    okAddress: "https://ok.example/p",
    missingAddress: "https://missing.example/",
    redirectAddress: "https://r.example/go",
  }));
  sourceContract("web fetch (fake fetch)", () => {
    const pages: Record<string, Response> = {};
    return {
      provider: new WebFetchSource({
        resolve: async () => ["93.184.216.34"],
        fetchImpl: (async (url: string) => {
          if (url === "https://ok.example/p")
            return new Response("page text here", {
              status: 200,
              headers: { "content-type": "text/html" },
            });
          if (url === "https://r.example/go")
            return new Response("", {
              status: 302,
              headers: { location: "https://elsewhere.example/" },
            });
          void pages;
          return new Response("", { status: 404 });
        }) as unknown as typeof fetch,
      }),
      okAddress: "https://ok.example/p",
      missingAddress: "https://missing.example/",
      redirectAddress: "https://r.example/go",
    };
  });
});
