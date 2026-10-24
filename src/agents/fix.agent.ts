import { getConfig } from '../config.js';
import { FixOutputSchema, type FixOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface FixInput {
  title: string;
  markdown: string;
  metaTitle: string | null;
  metaDescription: string | null;
  primaryKeyword: string | null;
  language: string;
  /** Failed checks, already described in words (e.g. "Length: 640 words (target 900-1600)"). */
  problems: string[];
}

function buildUserPrompt(input: FixInput): string {
  return [
    `TITULO: ${input.title}`,
    `IDIOMA DEL POST: ${input.language}`,
    `PALABRA CLAVE: ${input.primaryKeyword || '(ninguna)'}`,
    `META TITLE: ${input.metaTitle ?? '(sin SEO)'}`,
    `META DESCRIPTION: ${input.metaDescription ?? '(sin SEO)'}`,
    `PROBLEMAS DE CALIDAD A CORREGIR:\n${input.problems.map((p) => `- ${p}`).join('\n')}`,
    `ARTICULO (MARKDOWN):\n${input.markdown}`,
  ].join('\n\n');
}

/** Fixes the quality checklist problems of a plan (src/review/quality.ts) with the least change. */
export async function fixQuality(input: FixInput): Promise<{ data: FixOutput; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_fixed_article',
    // Same kind of job as the resolver (editing a finished plan): same model.
    role: 'resolve',
    schema: FixOutputSchema,
    system: loadPrompt('fix.system'),
    user: buildUserPrompt(input),
    maxTokens: cfg.AI_MAX_TOKENS,
  });
}
