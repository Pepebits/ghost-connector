import { getConfig } from '../config.js';
import { IdeasOutputSchema, type IdeasOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface IdeasInput {
  /** Published posts, newest first; the excerpt says what each one actually covers. */
  posts: Array<{ title: string; excerpt?: string }>;
  /** Drafts already in Ghost: not to be proposed again. */
  drafts?: string[];
  /** Ideas the editor discarded or already turned into drafts. */
  avoid?: string[];
  /** "Almost there" Search Console queries (query + impressions + position). */
  queries: Array<{ query: string; impressions: number; position: number }>;
}

const EXCERPT_POSTS = 60;
const EXCERPT_CHARS = 160;

/** Exported for the tests. */
export function buildUserPrompt(input: IdeasInput): string {
  const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
  // Excerpts only for the newest posts: enough context without paying for the whole archive.
  const posts = input.posts.map((p, i) => {
    const excerpt = i < EXCERPT_POSTS && p.excerpt ? oneLine(p.excerpt).slice(0, EXCERPT_CHARS) : '';
    return `- ${oneLine(p.title)}${excerpt ? ` — ${excerpt}` : ''}`;
  });
  const parts = [`POSTS PUBLICADOS DEL BLOG (${input.posts.length}, los mas recientes primero; "titulo — extracto"):\n${posts.join('\n')}`];
  const list = (items: string[]) => items.map((p) => `- ${p.replace(/[\r\n]+/g, ' ')}`).join('\n');
  if (input.drafts?.length) parts.push(`BORRADORES EN CURSO (ya se estan escribiendo, no los propongas):\n${list(input.drafts)}`);
  if (input.avoid?.length) parts.push(`IDEAS YA DESCARTADAS O USADAS (no las repitas ni propongas variantes casi iguales):\n${list(input.avoid)}`);
  if (input.queries.length) {
    parts.push(
      `BUSQUEDAS (GOOGLE/BING) EN SEGUNDA PAGINA (busqueda | impresiones | posicion media):\n${input.queries
        .map((q) => `- ${q.query.replace(/[\r\n]+/g, ' ')} | ${q.impressions} | ${q.position.toFixed(1)}`)
        .join('\n')}`,
    );
  }
  return parts.join('\n\n');
}

/** Topic ideas from the blog's own posts (and Search Console, when configured). */
export async function suggestIdeas(input: IdeasInput): Promise<{ data: IdeasOutput; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_topic_ideas',
    // A short, cheap call: same model as SEO.
    role: 'seo',
    schema: IdeasOutputSchema,
    system: loadPrompt('ideas.system'),
    user: buildUserPrompt(input),
    maxTokens: cfg.AI_MAX_TOKENS,
  });
}
