import OpenAI from 'openai';
import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse } from './types.js';

export interface OpenAICompatibleOpts {
  apiKey: string;
  baseURL: string;
  /**
   * DeepSeek-specific tweaks: disable "thinking mode" (it doesn't support a
   * named tool_choice) and read its cache fields (prompt_cache_hit_tokens).
   * Other compatible APIs might reject the `thinking` parameter.
   */
  deepseekQuirks: boolean;
}

function toOpenAIMessages(system: string, messages: LlmMessage[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.text,
        tool_calls: [{ id: m.toolCall.id, type: 'function', function: { name: m.toolCall.name, arguments: m.toolCall.arguments } }],
      });
    } else out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.text });
  }
  return out;
}

/**
 * Any API with OpenAI's Chat Completions format: DeepSeek,
 * OpenAI, OpenRouter, Groq, Ollama, LM Studio... Uses tool calling in
 * `strict` mode (with DeepSeek, at https://api.deepseek.com/beta) so the JSON
 * shape is guaranteed.
 */
export class OpenAICompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';
  private readonly client: OpenAI;

  constructor(private readonly opts: OpenAICompatibleOpts) {
    // maxRetries: the library retries 408/409/429/5xx with backoff and honors retry-after.
    this.client = new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 5 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const request = {
      model: req.model,
      max_tokens: req.maxTokens,
      messages: toOpenAIMessages(req.system, req.messages),
      tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.parameters, strict: true } }],
      tool_choice: { type: 'function', function: { name: req.tool.name } },
      ...(this.opts.deepseekQuirks ? { thinking: { type: 'disabled' } } : {}),
    } as unknown as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;

    const response = req.onPartial ? await this.streaming(request, req.onPartial) : await this.client.chat.completions.create(request);
    const raw = response.usage as unknown as
      | { prompt_tokens?: number; completion_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } }
      | undefined;
    // DeepSeek reports hit/miss; OpenAI, prompt_tokens_details.cached_tokens.
    const cached = this.opts.deepseekQuirks ? (raw?.prompt_cache_hit_tokens ?? 0) : (raw?.prompt_tokens_details?.cached_tokens ?? 0);
    const usage = {
      inputTokens: raw?.prompt_tokens ?? 0,
      outputTokens: raw?.completion_tokens ?? 0,
      cacheHitTokens: cached,
      cacheMissTokens: this.opts.deepseekQuirks ? (raw?.prompt_cache_miss_tokens ?? 0) : Math.max(0, (raw?.prompt_tokens ?? 0) - cached),
    };
    const choice = response.choices[0];
    const call = choice?.message?.tool_calls?.[0];
    return {
      toolCall: call && call.type === 'function' ? { id: call.id, name: call.function.name, arguments: call.function.arguments } : null,
      text: choice?.message?.content ?? null,
      finishReason: choice?.finish_reason ?? 'unknown',
      usage,
    };
  }

  /**
   * Same call, streamed: accumulates the first tool call's `arguments`,
   * notifies `onPartial` and rebuilds an equivalent ChatCompletion.
   */
  private async streaming(
    request: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    onPartial: (partialArgs: string) => void,
  ): Promise<OpenAI.Chat.ChatCompletion> {
    const stream = await this.client.chat.completions.create({ ...request, stream: true, stream_options: { include_usage: true } });
    let content = '';
    let toolId = '';
    let toolName = '';
    let args = '';
    let finishReason: OpenAI.Chat.ChatCompletion.Choice['finish_reason'] = 'stop';
    let usage: OpenAI.CompletionUsage | undefined;
    for await (const chunk of stream) {
      if (chunk.usage) usage = chunk.usage;
      const choice = chunk.choices[0];
      if (!choice) continue;
      if (choice.finish_reason) finishReason = choice.finish_reason;
      if (choice.delta.content) content += choice.delta.content;
      const call = choice.delta.tool_calls?.find((c) => c.index === 0);
      if (call) {
        if (call.id) toolId = call.id;
        if (call.function?.name) toolName += call.function.name;
        if (call.function?.arguments) {
          args += call.function.arguments;
          onPartial(args);
        }
      }
    }
    const toolCalls: OpenAI.Chat.ChatCompletionMessageToolCall[] = toolName
      ? [{ id: toolId, type: 'function', function: { name: toolName, arguments: args } }]
      : [];
    return {
      id: '',
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: request.model,
      usage,
      choices: [
        {
          index: 0,
          finish_reason: finishReason,
          logprobs: null,
          message: { role: 'assistant', content: content || null, refusal: null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) },
        },
      ],
    };
  }
}
