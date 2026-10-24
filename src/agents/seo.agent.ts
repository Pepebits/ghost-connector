import { getConfig } from '../config.js';
import { SeoOutputSchema, type SeoOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface SeoInput {
  title: string;
  markdown: string;
  existingTags: string[];
  currentSlug: string;
  /** Language of the post (writer's `language`), e.g. "es". */
  language?: string;
}

function buildUserPrompt(input: SeoInput): string {
  return [
    `TITULO: ${input.title}`,
    `IDIOMA DEL POST: ${input.language || '(el del articulo)'}`,
    `SLUG ACTUAL: ${input.currentSlug}`,
    `TAGS EXISTENTES DEL POST: ${input.existingTags.join(', ') || '(ninguno)'}`,
    `ARTICULO (markdown):\n${input.markdown}`,
  ].join('\n\n');
}

export async function planSeo(input: SeoInput): Promise<{ data: SeoOutput; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_seo',
    role: 'seo',
    schema: SeoOutputSchema,
    system: loadPrompt('seo.system'),
    user: buildUserPrompt(input),
    maxTokens: cfg.AI_MAX_TOKENS,
  });
}
