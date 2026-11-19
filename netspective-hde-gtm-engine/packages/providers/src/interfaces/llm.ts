import type { ProviderResult } from "./result.js";

// Language-model provider interface (feature 004, research R-05/R-18). No vendor types leak. External
// content is passed ONLY as delimited data blocks; the instruction channel is a separate string, and a call
// with external content carries an empty tool allow-list.

export interface DataBlock {
  id: string;
  label: string;
  text: string;
}

export type LlmTask = "extraction" | "synthesis" | "interpretation";

export interface LlmRequest {
  task: LlmTask;
  promptName: string;
  model: string;
  /** System and developer text from the versioned prompt file. Never contains external content. */
  instructions: string;
  /** External and untrusted text, delimited by `boundary`. */
  dataBlocks: readonly DataBlock[];
  boundary: string;
  /** JSON Schema of the required output (structured-output mode). */
  jsonSchema: object;
  maxOutputTokens: number;
  /** Names of tools the model may use. Empty for any call that carries external content. */
  tools: readonly string[];
  correlationId: string | null;
  /** On a retry: field paths and error codes only, never the model's own text. */
  repairNote?: string | undefined;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  toolCalls: { name: string }[];
}

export interface LLMProvider {
  readonly name: "fake" | "anthropic";
  complete(request: LlmRequest): Promise<ProviderResult<LlmResponse>>;
}
