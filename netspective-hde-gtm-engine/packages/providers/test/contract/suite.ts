import { expect, it } from "vitest";
import type { LLMProvider, LlmRequest } from "../../src/index.js";
import type { ResearchSourceProvider } from "../../src/index.js";

// Shared contract suites run against every implementation (feature 001 T097 slice). A provider error is a
// typed value; a provider never throws.

export const llmRequest = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  task: "extraction",
  promptName: "research-extract",
  model: "test-model",
  instructions: "Extract observations.",
  dataBlocks: [{ id: "b1", label: "source", text: "hello world" }],
  boundary: "bnd-1",
  jsonSchema: { type: "object" },
  maxOutputTokens: 500,
  tools: [],
  correlationId: "corr-1",
  ...over,
});

export function llmContract(
  name: string,
  make: () => { provider: LLMProvider; scripted: boolean },
) {
  it(`${name}: returns a typed result with token counts and never throws`, async () => {
    const { provider } = make();
    const result = await provider.complete(llmRequest());
    expect(typeof result.ok).toBe("boolean");
    if (result.ok) {
      expect(typeof result.value.text).toBe("string");
      expect(result.value.inputTokens).toBeGreaterThanOrEqual(0);
      expect(result.value.outputTokens).toBeGreaterThanOrEqual(0);
      expect(result.value.toolCalls).toEqual([]);
    } else {
      expect(typeof result.error.code).toBe("string");
      expect(typeof result.error.retryable).toBe("boolean");
    }
  });
}

export function sourceContract(
  name: string,
  make: () => {
    provider: ResearchSourceProvider;
    okAddress: string;
    missingAddress: string;
    redirectAddress: string;
  },
) {
  const base = { maxBytes: 1_000_000, timeoutMs: 1000, isApproved: () => true };
  it(`${name}: fetches an address and reports size and truncation`, async () => {
    const { provider, okAddress } = make();
    const r = await provider.fetch({ ...base, address: okAddress });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.text.length).toBeGreaterThan(0);
      expect(r.value.truncated).toBe(false);
    }
  });
  it(`${name}: returns a typed error for an unreachable address`, async () => {
    const { provider, missingAddress } = make();
    const r = await provider.fetch({ ...base, address: missingAddress });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("unreachable");
  });
  it(`${name}: refuses a redirect to an address that is not approved`, async () => {
    const { provider, redirectAddress } = make();
    const r = await provider.fetch({
      ...base,
      address: redirectAddress,
      isApproved: (a) => a === redirectAddress,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("redirect_not_approved");
  });
  it(`${name}: truncates a body above the byte limit and says so`, async () => {
    const { provider, okAddress } = make();
    const r = await provider.fetch({ ...base, address: okAddress, maxBytes: 5 });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.truncated).toBe(true);
      expect(Buffer.byteLength(r.value.text)).toBeLessThanOrEqual(5);
    }
  });
  it(`${name}: makes no network call when the analyst supplied the text`, async () => {
    const { provider } = make();
    const r = await provider.fetch({
      ...base,
      address: "https://anywhere.example/x",
      capturedText: "pasted page text",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.text).toBe("pasted page text");
  });
}
