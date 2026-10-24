/**
 * Common contract for AI providers. The runner (retries,
 * Zod validation, streaming for the live view) only talks to this;
 * each provider translates to its API.
 */

/** Neutral conversation: the minimum the "one tool call + correction" loop needs. */
export type LlmMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string | null; toolCall: ToolCall }
  | { role: 'tool'; toolCallId: string; text: string };

export interface ToolCall {
  id: string;
  name: string;
  /** JSON exactly as the model returned it (parsed and validated in the runner). */
  arguments: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  /** "Strict" JSON Schema (everything required, additionalProperties:false). */
  parameters: Record<string, unknown>;
}

export interface LlmRequest {
  model: string;
  system: string;
  messages: LlmMessage[];
  tool: ToolSpec;
  maxTokens: number;
  /** If given, the call is streamed and receives the accumulated partial arguments. */
  onPartial?: (partialArgs: string) => void;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
}

export interface LlmResponse {
  toolCall: ToolCall | null;
  text: string | null;
  finishReason: string;
  usage: LlmUsage;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}
