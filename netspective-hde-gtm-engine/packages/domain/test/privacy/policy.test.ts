import { describe, expect, it } from "vitest";
import { DEFAULT_GUARD_POLICY, ENTRY_POINTS, resolveGuardAction } from "../../src/privacy/index.js";

describe("reject versus quarantine policy", () => {
  it("rejects by default at every entry point", () => {
    for (const entryPoint of ENTRY_POINTS) {
      expect(resolveGuardAction(entryPoint)).toBe("reject");
      expect(resolveGuardAction(entryPoint, DEFAULT_GUARD_POLICY)).toBe("reject");
    }
  });

  it("quarantines only entry points explicitly configured for review", () => {
    const config = { quarantineEntryPoints: ["upload", "webhook:partner-feed"] };
    expect(resolveGuardAction("upload", config)).toBe("quarantine");
    expect(resolveGuardAction("webhook:partner-feed", config)).toBe("quarantine");
    expect(resolveGuardAction("api_body", config)).toBe("reject");
    expect(resolveGuardAction("webhook:other-feed", config)).toBe("reject");
  });

  it("never quarantines content bound for logs, audit, providers or models", () => {
    const config = {
      quarantineEntryPoints: ["log", "audit", "provider_call", "llm_preflight", "upload"],
    };
    for (const entryPoint of ["log", "audit", "provider_call", "llm_preflight"]) {
      expect(resolveGuardAction(entryPoint, config)).toBe("reject");
    }
    expect(resolveGuardAction("upload", config)).toBe("quarantine");
  });
});
