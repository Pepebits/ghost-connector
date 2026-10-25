import { assertUserBudget, recordUsage } from './usage.js';
import type { CostAgent } from '../types.js';
import { z } from 'zod';
import { getConfig, type Config } from '../config.js';
import { aiLimiter } from '../util/limiter.js';
import { costUsd } from './pricing.js';
import { llmProvider } from './providers/index.js';
import type { LlmMessage } from './providers/types.js';

export class AgentParseError extends Error {
  constructor(agentName: string, detail: string) {
    super(`Agent "${agentName}" did not return valid output: ${detail}`);
    this.name = 'AgentParseError';
  }
}

export interface AgentUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  /** Model that answered (may vary per agent: AI_MODEL_<AGENT>). */
  model: string;
  /** Cost in USD, or null if no price is configured for that model. */
  usd: number | null;
}

export type AgentRole = 'writer' | 'seo' | 'image' | 'resolve';

/** Model for each agent: AI_MODEL_<AGENT> if set, otherwise AI_MODEL. */
export function modelFor(role: AgentRole, cfg: Config = getConfig()): string {
  const perAgent = { writer: cfg.AI_MODEL_WRITER, seo: cfg.AI_MODEL_SEO, image: cfg.AI_MODEL_IMAGE, resolve: cfg.AI_MODEL_RESOLVE }[role];
  return perAgent || cfg.AI_MODEL;
}

export interface RunAgentOpts<T extends z.ZodTypeAny> {
  name: string;
  /** Which agent this is (determines the model, see modelFor). */
  role: AgentRole;
  schema: T;
  system: string;
  user: string;
  maxTokens?: number;
  /**
   * If given, the call is streamed and this is invoked with the
   * `arguments` (still-incomplete JSON) accumulated so far. Only
   * for showing live progress: validation still runs on the
   * complete response.
   */
  onPartial?: (partialArgs: string) => void;
}

export interface RunAgentResult<T> {
  data: T;
  usage: AgentUsage;
}

/**
 * "Strict" tool calling (DeepSeek on .../beta, OpenAI) requires ALL
 * properties to be in `required` and `additionalProperties:false` at every
 * object level. z.toJSONSchema honors Zod's `.optional()`, so
 * we force the schema after generating it instead of loosening the Zod types.
 */
function toStrictJsonSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toStrictJsonSchema);
  if (node && typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
      obj.required = Object.keys(obj.properties as Record<string, unknown>);
      obj.additionalProperties = false;
      for (const [key, value] of Object.entries(obj.properties as Record<string, unknown>)) {
        (obj.properties as Record<string, unknown>)[key] = toStrictJsonSchema(value);
      }
    }
    if (obj.items) obj.items = toStrictJsonSchema(obj.items);
    return obj;
  }
  return node;
}

export function buildStrictParameters(schema: z.ZodTypeAny): Record<string, unknown> {
  // io 'input': the shape the model must send (before transforms/defaults).
  const json = z.toJSONSchema(schema, { target: 'draft-7', io: 'input', reused: 'inline', unrepresentable: 'any' }) as Record<string, unknown>;
  delete json.$schema;
  return toStrictJsonSchema(json) as Record<string, unknown>;
}

const MAX_ATTEMPTS = 2;

/**
 * Base prompts are generic; blog-specific details (topic,
 * audience, tone) come from SITE_CONTEXT and go at the END of the system prompt:
 * it's stable per site, so the cacheable prefix doesn't change between calls.
 */
export function withSiteContext(system: string, siteContext: string): string {
  const ctx = siteContext.trim();
  return ctx ? `${system.trimEnd()}\n\nCONTEXTO DEL SITIO:\n${ctx}\n` : system;
}

/**
 * Runs a "single-call" subagent: stable system prompt + volatile
 * input -> output validated against `schema`. Uses tool calling (in
 * strict mode where the provider supports it) to guarantee the SHAPE of the JSON; it's still revalidated
 * with Zod because strict mode doesn't cover value constraints (e.g. a
 * string longer than `max()`, or a regex). If Zod validation fails, it
 * retries once, returning the exact error to the model as the result of
 * the tool call, so it can fix it.
 */
/** Ledger name of each agent, by its tool name (see agents/usage.ts). */
const LEDGER_AGENT: Record<string, CostAgent> = {
  submit_article: 'writer',
  submit_seo: 'seo',
  submit_image_plan: 'image',
  submit_resolved_article: 'resolve',
  submit_fixed_article: 'fix',
  submit_topic_ideas: 'ideas',
  submit_snippet_options: 'snippet',
};

export async function runAgent<T extends z.ZodTypeAny>(
  opts: RunAgentOpts<T>,
): Promise<RunAgentResult<z.infer<T>>> {
  assertUserBudget();
  const usage: AgentUsage = { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, model: modelFor(opts.role), usd: null };
  try {
    return await runAgentCalls(opts, usage);
  } finally {
    // Failed calls are paid for too.
    recordUsage({ agent: LEDGER_AGENT[opts.name] ?? opts.role, model: usage.model, usd: usage.usd, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
  }
}

async function runAgentCalls<T extends z.ZodTypeAny>(opts: RunAgentOpts<T>, usage: AgentUsage): Promise<RunAgentResult<z.infer<T>>> {
  const cfg = getConfig();
  const provider = llmProvider();
  const model = modelFor(opts.role, cfg);
  const tool = { name: opts.name, description: `Devuelve la salida estructurada de ${opts.name}.`, parameters: buildStrictParameters(opts.schema) };
  const system = withSiteContext(opts.system, cfg.SITE_CONTEXT);
  const messages: LlmMessage[] = [{ role: 'user', text: opts.user }];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await aiLimiter(() =>
      provider.complete({ model, system, messages, tool, maxTokens: opts.maxTokens ?? cfg.AI_MAX_TOKENS, onPartial: opts.onPartial }),
    );
    usage.inputTokens += response.usage.inputTokens;
    usage.outputTokens += response.usage.outputTokens;
    usage.cacheHitTokens += response.usage.cacheHitTokens;
    usage.cacheMissTokens += response.usage.cacheMissTokens;
    usage.usd = costUsd(model, usage.inputTokens, usage.outputTokens);

    const toolCall = response.toolCall;
    const isLastAttempt = attempt === MAX_ATTEMPTS;

    if (!toolCall) {
      if (isLastAttempt) throw new AgentParseError(opts.name, `returned no tool_calls (finish_reason=${response.finishReason})`);
      messages.push({ role: 'user', text: `Llama a la funcion "${opts.name}" con la salida estructurada. No respondas con texto libre.` });
      continue;
    }

    let rawArgs: unknown;
    let parseIssue: string | null = null;
    try {
      rawArgs = JSON.parse(toolCall.arguments);
    } catch (err) {
      parseIssue = `arguments is not valid JSON: ${(err as Error).message}`;
    }

    const parsed = parseIssue === null ? opts.schema.safeParse(rawArgs) : null;
    if (parsed?.success) return { data: parsed.data, usage };

    const detail = parseIssue ?? parsed!.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    if (isLastAttempt) throw new AgentParseError(opts.name, detail);

    messages.push({ role: 'assistant', text: response.text, toolCall });
    messages.push({
      role: 'tool',
      toolCallId: toolCall.id,
      text: `Tu respuesta no es valida: ${detail}. Vuelve a llamar a la funcion "${opts.name}" corrigiendo exactamente eso, respetando los limites de longitud y formato.`,
    });
  }

  // Unreachable: the last attempt always returns or throws inside the loop.
  throw new AgentParseError(opts.name, 'retries exhausted');
}
