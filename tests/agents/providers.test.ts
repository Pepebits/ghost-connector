import { describe, expect, it } from 'vitest';
import { AnthropicProvider, toAnthropicMessages } from '../../src/agents/providers/anthropic.js';
import type { LlmRequest } from '../../src/agents/providers/types.js';

const TOOL = { name: 'submit_seo', description: 'x', parameters: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false } };

function fakeFetch(handler: (body: Record<string, unknown>) => Response) {
  const calls: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, headers: init.headers as Record<string, string>, body });
    return handler(body);
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const req = (over: Partial<LlmRequest> = {}): LlmRequest => ({
  model: 'claude-sonnet-5-5', system: 'Eres SEO.', messages: [{ role: 'user', text: 'articulo' }], tool: TOOL, maxTokens: 100, ...over,
});

describe('agents/providers/anthropic', () => {
  it('fuerza la herramienta, cachea el system prompt y lee la tool_use', async () => {
    const { impl, calls } = fakeFetch(() =>
      Response.json({
        content: [{ type: 'tool_use', id: 'tu_1', name: 'submit_seo', input: { a: 'hola' } }],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 90, cache_creation_input_tokens: 0 },
      }),
    );
    const res = await new AnthropicProvider({ apiKey: 'k', baseURL: 'https://api.anthropic.com/', fetchImpl: impl }).complete(req());
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0]!.headers['x-api-key']).toBe('k');
    expect(calls[0]!.body.tool_choice).toEqual({ type: 'tool', name: 'submit_seo' });
    expect((calls[0]!.body.system as Array<{ cache_control?: unknown }>)[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(res.toolCall).toEqual({ id: 'tu_1', name: 'submit_seo', arguments: '{"a":"hola"}' });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 5, cacheHitTokens: 90, cacheMissTokens: 10 });
  });

  it('streaming: acumula input_json_delta y avisa de cada trozo', async () => {
    const events = [
      { type: 'message_start', message: { usage: { input_tokens: 20, output_tokens: 1 } } },
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'tu_2', name: 'submit_seo', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a":"ho' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: 'la"}' } },
      { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ];
    const sse = events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
    // Chunks that split events midway, as they arrive over the network.
    const chunks = [sse.slice(0, 50), sse.slice(50, 333), sse.slice(333)];
    const { impl } = fakeFetch(
      () => new Response(new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch)); c.close(); } })),
    );
    const partials: string[] = [];
    const res = await new AnthropicProvider({ apiKey: 'k', baseURL: 'https://api.anthropic.com', fetchImpl: impl }).complete(req({ onPartial: (p) => partials.push(p) }));
    expect(partials).toEqual(['{"a":"ho', '{"a":"hola"}']);
    expect(res.toolCall?.arguments).toBe('{"a":"hola"}');
    expect(res.finishReason).toBe('tool_use');
    expect(res.usage.outputTokens).toBe(7);
  });

  it('el reintento de correccion va como tool_result con is_error', () => {
    const msgs = toAnthropicMessages([
      { role: 'user', text: 'hola' },
      { role: 'assistant', text: null, toolCall: { id: 't', name: 'submit_seo', arguments: '{"a":1}' } },
      { role: 'tool', toolCallId: 't', text: 'a: Expected string' },
    ]);
    expect(msgs[1]).toEqual({ role: 'assistant', content: [{ type: 'tool_use', id: 't', name: 'submit_seo', input: { a: 1 } }] });
    expect(msgs[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'a: Expected string', is_error: true }] });
  });

  it('un error no reintentable se lanza con el mensaje de la API', async () => {
    const { impl } = fakeFetch(() => Response.json({ error: { message: 'invalid x-api-key' } }, { status: 401 }));
    await expect(new AnthropicProvider({ apiKey: 'k', baseURL: 'https://api.anthropic.com', fetchImpl: impl }).complete(req())).rejects.toThrow(/401: invalid x-api-key/);
  });
});

describe('agents: modelos y precios', () => {
  it('cada agente usa su modelo si lo tiene, si no AI_MODEL', async () => {
    const { modelFor } = await import('../../src/agents/runner.js');
    const { getConfig } = await import('../../src/config.js');
    const cfg = { ...getConfig(), AI_MODEL: 'base', AI_MODEL_SEO: 'barato' };
    expect(modelFor('seo', cfg)).toBe('barato');
    expect(modelFor('writer', cfg)).toBe('base');
  });

  it('AI_PRICES: formato y precios', async () => {
    const { parsePrices } = await import('../../src/config.js');
    expect(parsePrices('gpt-4o-mini=0.15/0.6, claude-x = 3/15')?.get('claude-x')).toEqual({ input: 3, output: 15 });
    expect(parsePrices('')?.size).toBe(0);
    expect(parsePrices('roto')).toBeNull();
    const { costUsd } = await import('../../src/agents/pricing.js');
    expect(costUsd('deepseek-flash', 1_000_000, 1_000_000)).toBeCloseTo(0.75);
    expect(costUsd('modelo-sin-precio', 1000, 1000)).toBeNull();
  });

  it('valores por defecto segun el proveedor', async () => {
    const { validateEnv } = await import('../../src/config.js');
    const base = { ...process.env, AI_MODEL: '', AI_BASE_URL: '' };
    const anth = validateEnv({ ...base, AI_PROVIDER: 'anthropic' });
    expect(anth.ok && [anth.config.AI_BASE_URL, anth.config.AI_MODEL]).toEqual(['https://api.anthropic.com', 'claude-sonnet-5-5']);
    const compat = validateEnv({ ...base, AI_PROVIDER: 'openai-compatible' });
    expect(compat.ok).toBe(false);
  });
});

describe('agents/providers: DeepSeek por URL', () => {
  it('los ajustes de DeepSeek se aplican por el servidor, no solo por AI_PROVIDER', async () => {
    const { isDeepSeek } = await import('../../src/agents/providers/index.js');
    expect(isDeepSeek('openai-compatible', 'https://api.deepseek.com/beta')).toBe(true);
    expect(isDeepSeek('deepseek', '')).toBe(true);
    expect(isDeepSeek('openai-compatible', 'https://api.openai.com/v1')).toBe(false);
    expect(isDeepSeek('openai-compatible', 'https://deepseek.com.evil.test/v1')).toBe(false);
  });
});
