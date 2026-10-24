import type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmUsage, ToolCall } from './types.js';

export interface AnthropicOpts {
  apiKey: string;
  /** Defaults to https://api.anthropic.com */
  baseURL: string;
  /** Injectable in tests. */
  fetchImpl?: typeof fetch;
}

const API_VERSION = '2023-06-01';
const MAX_RETRIES = 5;

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean };

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | ContentBlock[];
}

/** The neutral conversation in Messages format (tool_results go in a "user" turn). */
export function toAnthropicMessages(messages: LlmMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  for (const m of messages) {
    if (m.role === 'user') out.push({ role: 'user', content: m.text });
    else if (m.role === 'assistant') {
      let input: unknown = {};
      try {
        input = JSON.parse(m.toolCall.arguments);
      } catch {
        input = {}; // broken arguments: the runner is already asking it to fix them
      }
      const blocks: ContentBlock[] = [];
      if (m.text) blocks.push({ type: 'text', text: m.text });
      blocks.push({ type: 'tool_use', id: m.toolCall.id, name: m.toolCall.name, input });
      out.push({ role: 'assistant', content: blocks });
    } else {
      out.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.text, is_error: true }] });
    }
  }
  return out;
}

function usageFrom(u: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } | undefined): LlmUsage {
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const cacheWrite = u?.cache_creation_input_tokens ?? 0;
  const uncached = u?.input_tokens ?? 0;
  return {
    // Anthropic's input_tokens excludes cache reads/writes: they're added for the real total.
    inputTokens: uncached + cacheRead + cacheWrite,
    outputTokens: u?.output_tokens ?? 0,
    cacheHitTokens: cacheRead,
    cacheMissTokens: uncached + cacheWrite,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Anthropic Messages API (Claude). Forces the tool with
 * tool_choice {type:"tool"} and marks the system prompt as cacheable: it's
 * stable across calls (the site context goes at the end), so
 * subsequent ones read it from cache. No "strict" mode: the JSON shape is
 * revalidated by the runner with Zod, which retries returning the error.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: AnthropicOpts) {
    this.fetch = opts.fetchImpl ?? fetch;
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const body = {
      model: req.model,
      max_tokens: req.maxTokens,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: toAnthropicMessages(req.messages),
      tools: [{ name: req.tool.name, description: req.tool.description, input_schema: req.tool.parameters }],
      tool_choice: { type: 'tool', name: req.tool.name },
      ...(req.onPartial ? { stream: true } : {}),
    };
    const res = await this.post(body);
    return req.onPartial ? this.readStream(res, req.onPartial) : this.readJson(res);
  }

  /** POST with retries on 429/5xx/529 (overloaded), honoring retry-after. */
  private async post(body: unknown): Promise<Response> {
    const url = `${this.opts.baseURL.replace(/\/+$/, '')}/v1/messages`;
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.opts.apiKey, 'anthropic-version': API_VERSION },
        body: JSON.stringify(body),
      });
      if (res.ok) return res;
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= MAX_RETRIES) {
        const text = await res.text().catch(() => '');
        let message = text.slice(0, 300);
        try {
          message = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? message;
        } catch {
          /* non-JSON body */
        }
        throw Object.assign(new Error(`Anthropic HTTP ${res.status}: ${message}`), { status: res.status });
      }
      const after = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(after) && after > 0 ? after * 1000 : Math.min(30_000, 1000 * 2 ** attempt));
    }
  }

  private async readJson(res: Response): Promise<LlmResponse> {
    const data = (await res.json()) as { content: ContentBlock[]; stop_reason?: string; usage?: Parameters<typeof usageFrom>[0] };
    const tool = data.content.find((b): b is Extract<ContentBlock, { type: 'tool_use' }> => b.type === 'tool_use');
    const text = data.content.filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
    return {
      toolCall: tool ? { id: tool.id, name: tool.name, arguments: JSON.stringify(tool.input) } : null,
      text: text || null,
      finishReason: data.stop_reason ?? 'unknown',
      usage: usageFrom(data.usage),
    };
  }

  /** SSE events: the tool JSON arrives in chunks in input_json_delta. */
  private async readStream(res: Response, onPartial: (partialArgs: string) => void): Promise<LlmResponse> {
    if (!res.body) throw new Error('Anthropic: streaming response without a body');
    const decoder = new TextDecoder();
    let buffer = '';
    let text = '';
    let tool: ToolCall | null = null;
    let finishReason = 'unknown';
    let usage: Parameters<typeof usageFrom>[0] = {};

    const handle = (event: { type: string; [k: string]: unknown }) => {
      if (event.type === 'message_start') usage = { ...((event.message as { usage?: object })?.usage ?? {}) };
      else if (event.type === 'content_block_start') {
        const block = event.content_block as { type: string; id?: string; name?: string };
        if (block.type === 'tool_use' && !tool) tool = { id: block.id ?? '', name: block.name ?? '', arguments: '' };
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta as { type: string; partial_json?: string; text?: string };
        if (delta.type === 'input_json_delta' && tool && delta.partial_json) {
          tool.arguments += delta.partial_json;
          onPartial(tool.arguments);
        } else if (delta.type === 'text_delta' && delta.text) text += delta.text;
      } else if (event.type === 'message_delta') {
        const d = event.delta as { stop_reason?: string };
        if (d?.stop_reason) finishReason = d.stop_reason;
        usage = { ...usage, ...((event.usage as object) ?? {}) };
      } else if (event.type === 'error') {
        throw new Error(`Anthropic: ${(event.error as { message?: string })?.message ?? 'stream error'}`);
      }
    };

    const reader = res.body.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = raw
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trim())
          .join('');
        if (data) handle(JSON.parse(data));
      }
      if (done) break;
    }
    const finalTool = tool as ToolCall | null;
    if (finalTool && !finalTool.arguments) finalTool.arguments = '{}';
    return { toolCall: finalTool, text: text || null, finishReason, usage: usageFrom(usage) };
  }
}
