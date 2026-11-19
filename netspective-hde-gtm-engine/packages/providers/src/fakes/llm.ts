import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import type { LLMProvider, LlmRequest, LlmResponse } from "../interfaces/llm.js";

// Deterministic scriptable fake language model (feature 004, research R-18). Rules match a task and strings
// that must appear in the data blocks. `$BLOCK:n` in a scripted answer stands for the id of the n-th data
// block. The fake reports token counts, can return invalid, errored and sequenced answers, and can be told
// to OBEY injected text: if such text ever reached its instruction channel (or it were given tools) it
// follows it, so a test can prove it never does.

export interface FakeRule {
  task: LlmRequest["task"];
  whenTextIncludes: string[];
  respond?: unknown;
  respondRaw?: string;
  sequence?: (
    { respond?: unknown; respondRaw?: string } | { error: { code: string; retryable: boolean } }
  )[];
  error?: { code: string; retryable: boolean };
  repeat?: boolean;
  tokens?: { input: number; output: number };
}

const INJECTED = /mark this account as qualified|ignore previous instructions|call the \w+ tool/i;

function substitute(value: unknown, blocks: LlmRequest["dataBlocks"]): unknown {
  if (typeof value === "string") {
    const m = /^\$BLOCK:(\d+)$/.exec(value);
    return m ? (blocks[Number(m[1]) - 1]?.id ?? value) : value;
  }
  if (Array.isArray(value)) return value.map((v) => substitute(v, blocks));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v, blocks)]));
  }
  return value;
}

export class FakeLLM implements LLMProvider {
  readonly name = "fake" as const;
  readonly calls: LlmRequest[] = [];
  /** True if an injected instruction ever reached the instruction channel or a tool was offered. */
  obeyedInjection = false;
  private readonly used = new Map<FakeRule, number>();

  constructor(
    private readonly rules: readonly FakeRule[],
    private readonly options: { obeyInjection?: boolean } = {},
  ) {}

  async complete(request: LlmRequest): Promise<ProviderResult<LlmResponse>> {
    this.calls.push(request);
    const text = request.dataBlocks.map((b) => b.text).join("\n");
    const inputTokens = Math.ceil(
      (request.instructions.length + request.dataBlocks.reduce((n, b) => n + b.text.length, 0)) / 4,
    );
    const toolCalls: { name: string }[] = [];
    if (
      this.options.obeyInjection &&
      (INJECTED.test(request.instructions) || request.tools.length > 0)
    ) {
      this.obeyedInjection = true;
      if (request.tools[0] && INJECTED.test(text)) toolCalls.push({ name: request.tools[0] });
    }
    const rule = this.rules.find(
      (r) => r.task === request.task && r.whenTextIncludes.every((s) => text.includes(s)),
    );
    if (!rule) return fail("no_scripted_response", false);
    const count = this.used.get(rule) ?? 0;
    this.used.set(rule, count + 1);
    const step = rule.sequence ? rule.sequence[Math.min(count, rule.sequence.length - 1)]! : rule;
    if (
      !rule.sequence &&
      !rule.repeat &&
      count > 0 &&
      !rule.respond &&
      !rule.respondRaw &&
      !rule.error
    ) {
      return fail("no_scripted_response", false);
    }
    if ("error" in step && step.error) return fail(step.error.code, step.error.retryable);
    const body =
      "respondRaw" in step && step.respondRaw !== undefined
        ? step.respondRaw
        : JSON.stringify(
            substitute((step as { respond?: unknown }).respond ?? {}, request.dataBlocks),
          );
    return ok({
      text: body,
      inputTokens: rule.tokens?.input ?? inputTokens,
      outputTokens: rule.tokens?.output ?? Math.ceil(body.length / 4),
      model: request.model,
      toolCalls,
    });
  }
}
