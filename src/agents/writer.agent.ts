import { getConfig } from '../config.js';
import { WriterOutputSchema, type DraftSnapshot, type WriterOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';
import { AI_PROCESSED_TAG } from '../orchestrator/merge.js';

/** `draft` = complete a draft; `improve` = improve an already finished version; `auto` = decide here. */
export type WriterMode = 'auto' | 'draft' | 'improve';

// Above this the post already "is an article", even if it never went through the connector.
const IMPROVE_MIN_WORDS = 600;

export function resolveWriterMode(draft: DraftSnapshot, mode: WriterMode = 'auto'): 'draft' | 'improve' {
  if (mode !== 'auto') return mode;
  const processed = draft.tags.some((t) => t.name.toLowerCase() === AI_PROCESSED_TAG.toLowerCase());
  const words = (draft.html ?? '').replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
  return processed || words >= IMPROVE_MIN_WORDS ? 'improve' : 'draft';
}

function buildUserPrompt(draft: DraftSnapshot, mode: 'draft' | 'improve', extraInstructions?: string, sources?: string): string {
  const parts = [
    `MODO: ${mode === 'improve' ? 'MEJORA (ya hay una version terminada; mejorala)' : 'BORRADOR (completa el borrador)'}`,
    `TITULO ACTUAL: ${draft.title}`,
    `CONTENIDO ACTUAL (HTML):\n${draft.html ?? '(vacio)'}`,
    `TAGS EXISTENTES: ${draft.tags.map((t) => t.name).join(', ') || '(ninguno)'}`,
  ];
  if (extraInstructions) parts.push(`INSTRUCCIONES ADICIONALES DEL EDITOR: ${extraInstructions}`);
  if (sources) parts.push(sources);
  return parts.join('\n\n');
}

export async function writeArticle(
  draft: DraftSnapshot,
  extraInstructions?: string,
  onPartial?: (partialArgs: string) => void,
  mode: WriterMode = 'auto',
  /** sourcesBlock() block with what was read from the editor's URLs. */
  sources?: string,
): Promise<{ data: WriterOutput; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_article',
    role: 'writer',
    schema: WriterOutputSchema,
    system: loadPrompt('writer.system'),
    user: buildUserPrompt(draft, resolveWriterMode(draft, mode), extraInstructions, sources),
    maxTokens: cfg.AI_MAX_TOKENS,
    onPartial,
  });
}
