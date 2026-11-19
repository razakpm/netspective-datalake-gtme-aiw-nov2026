import { fail, ok, type ProviderResult } from "../interfaces/result.js";
import type { LLMProvider, LlmRequest, LlmResponse } from "../interfaces/llm.js";

// Anthropic Messages API adapter (feature 004, research R-18). Plain `fetch`, no vendor SDK. This is the
// only file that knows the vendor's request and response shapes. The key is passed in by the caller (read
// from the environment by name) and is never logged or returned. It is exercised in tests only against an
// injected fake `fetch`.

export interface AnthropicOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

const VERSION = "2023-06-01";

/** Assemble the single user turn: delimited data blocks only, with the boundary token declared. */
function userContent(request: LlmRequest): string {
  const blocks = request.dataBlocks
    .map(
      (b) =>
        `<<DATA id=${b.id} label=${JSON.stringify(b.label)} boundary=${request.boundary}>>\n${b.text}\n<<END ${request.boundary}>>`,
    )
    .join("\n\n");
  const repair = request.repairNote
    ? `\n\nYour previous answer did not match the schema. Fix only these fields: ${request.repairNote}`
    : "";
  return `${blocks}${repair}`;
}

export class AnthropicLLM implements LLMProvider {
  readonly name = "anthropic" as const;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: AnthropicOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl ?? "https://api.anthropic.com";
  }

  async complete(request: LlmRequest): Promise<ProviderResult<LlmResponse>> {
    if (request.dataBlocks.length > 0 && request.tools.length > 0) {
      // Defence in depth: a call that carries external content never offers tools.
      return fail("tools_not_allowed_with_external_content", false);
    }
    const body = {
      model: request.model,
      max_tokens: request.maxOutputTokens,
      system: request.instructions,
      messages: [{ role: "user", content: userContent(request) }],
      // Structured output: force a single tool whose input schema is the required output.
      tools: [
        {
          name: "return_result",
          description: "Return the structured result.",
          input_schema: request.jsonSchema,
        },
      ],
      tool_choice: { type: "tool", name: "return_result" },
    };
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": this.options.apiKey,
          "anthropic-version": VERSION,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return fail("unreachable", true);
    }
    if (response.status === 429 || response.status >= 500)
      return fail("provider_unavailable", true);
    if (!response.ok) return fail("provider_rejected", false);
    let json: {
      content?: { type: string; input?: unknown; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    try {
      json = (await response.json()) as typeof json;
    } catch {
      return fail("invalid_provider_response", true);
    }
    const toolUse = json.content?.find((c) => c.type === "tool_use");
    const text = toolUse
      ? JSON.stringify(toolUse.input ?? {})
      : (json.content?.find((c) => c.type === "text")?.text ?? "");
    return ok({
      text,
      inputTokens: json.usage?.input_tokens ?? 0,
      outputTokens: json.usage?.output_tokens ?? 0,
      model: json.model ?? request.model,
      // The forced result tool is ours, not an action; no other tool exists.
      toolCalls: [],
    });
  }
}
