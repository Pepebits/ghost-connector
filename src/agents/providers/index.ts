import { getConfig, onConfigReload } from '../../config.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenAICompatibleProvider } from './openaiCompatible.js';
import type { LlmProvider } from './types.js';

/**
 * The DeepSeek tweaks depend on the server being talked to, not on the
 * chosen name: with AI_PROVIDER=openai-compatible pointing at
 * api.deepseek.com they're needed too (without them, DeepSeek rejects the
 * tool_choice: "Thinking mode does not support this tool_choice").
 */
export function isDeepSeek(provider: string, baseUrl: string): boolean {
  if (provider === 'deepseek') return true;
  try {
    return /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

let cached: LlmProvider | null = null;
onConfigReload(() => {
  cached = null;
});

/** The configured provider (AI_PROVIDER), created once and rebuilt if the config changes. */
export function llmProvider(): LlmProvider {
  if (cached) return cached;
  const cfg = getConfig();
  cached =
    cfg.AI_PROVIDER === 'anthropic'
      ? new AnthropicProvider({ apiKey: cfg.AI_API_KEY, baseURL: cfg.AI_BASE_URL })
      : new OpenAICompatibleProvider({ apiKey: cfg.AI_API_KEY, baseURL: cfg.AI_BASE_URL, deepseekQuirks: isDeepSeek(cfg.AI_PROVIDER, cfg.AI_BASE_URL) });
  return cached;
}

export type { LlmProvider } from './types.js';
