import { describe, expect, it } from "vitest";
import { loadWebConfig, WebConfigError } from "../src/config.js";

describe("web config encrypted transport", () => {
  it("requires https for the web-to-API connection in production", () => {
    expect(() =>
      loadWebConfig({ NODE_ENV: "production", API_BASE_URL: "http://api.example.org" }),
    ).toThrow(WebConfigError);
    expect(
      loadWebConfig({ NODE_ENV: "production", API_BASE_URL: "https://api.example.org" }),
    ).toEqual({ env: "production", apiBaseUrl: "https://api.example.org" });
  });

  it("allows plain http on localhost outside production", () => {
    for (const nodeEnv of ["development", "test"]) {
      expect(
        loadWebConfig({ NODE_ENV: nodeEnv, API_BASE_URL: "http://localhost:3000" }).apiBaseUrl,
      ).toBe("http://localhost:3000");
    }
  });

  it("names the setting and never prints the URL", () => {
    let message = "";
    try {
      loadWebConfig({
        NODE_ENV: "production",
        API_BASE_URL: "http://user:hunter2pass@api.example.org",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("API_BASE_URL");
    expect(message).not.toContain("hunter2pass");
  });

  it("fails when the API base URL is missing or malformed", () => {
    expect(() => loadWebConfig({})).toThrow(WebConfigError);
    expect(() => loadWebConfig({ API_BASE_URL: "not a url" })).toThrow(WebConfigError);
  });
});
