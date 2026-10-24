import { getConfig } from '../config.js';
import { SnippetOutputSchema, type SnippetOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface SnippetInput {
  title: string;
  query: string;
  position: number;
  ctr: number;
  metaTitle: string;
  metaDescription: string;
  excerpt: string;
  language: string;
}

const oneLine = (s: string) => s.replace(/[\r\n]+/g, ' ').trim();

function buildUserPrompt(i: SnippetInput): string {
  return [
    `IDIOMA DEL POST: ${i.language}`,
    `BUSQUEDA: ${oneLine(i.query)} (posicion media ${i.position.toFixed(1)}, CTR ${(i.ctr * 100).toFixed(1)} %)`,
    `TITULO DEL POST: ${oneLine(i.title)}`,
    `META TITLE ACTUAL: ${oneLine(i.metaTitle) || '(vacio: Google usa el titulo del post)'}`,
    `META DESCRIPTION ACTUAL: ${oneLine(i.metaDescription) || '(vacia: Google elige un trozo del texto)'}`,
    `EXTRACTO DEL POST:\n${i.excerpt}`,
  ].join('\n\n');
}

/** Alternative Google title + description for a published post with a low CTR. */
export async function suggestSnippet(input: SnippetInput): Promise<{ data: SnippetOutput; usage: AgentUsage }> {
  return runAgent({
    name: 'submit_snippet_options',
    role: 'seo',
    schema: SnippetOutputSchema,
    system: loadPrompt('snippet.system'),
    user: buildUserPrompt(input),
    maxTokens: getConfig().AI_MAX_TOKENS,
  });
}
