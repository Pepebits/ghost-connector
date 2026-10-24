import { getConfig } from '../config.js';
import { ResolveOutputSchema, type ResolveOutput } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface PendingQA {
  question: string;
  /** Empty/blank = the editor didn't answer this one; the marker is left as is. */
  answer: string;
}

export interface ResolveInput {
  title: string;
  html: string;
  qas: PendingQA[];
  /** Already-integrated answers the editor is correcting: that part of the text must be redone. */
  corrections?: Array<{ question: string; previous: string; answer: string }>;
  /** sourcesBlock() block with what was read from any URLs in the answers. */
  sources?: string;
  /** Language of the post, when known (from the plan). */
  language?: string;
}

function buildUserPrompt(input: ResolveInput): string {
  const qaBlock = input.qas
    .map(
      (qa, i) =>
        `PREGUNTA ${i + 1}: ${qa.question}\nRESPUESTA: ${qa.answer.trim() || '(sin responder, deja el marcador tal cual)'}`,
    )
    .join('\n\n');

  return [
    `TITULO: ${input.title}`,
    `IDIOMA DEL POST: ${input.language || '(el del articulo)'}`,
    `ARTICULO ACTUAL (HTML, con marcadores [[PENDING:]]):\n${input.html}`,
    `RESPUESTAS DEL EDITOR A LOS PENDIENTES:\n${qaBlock}`,
    ...(input.corrections?.length
      ? [
          `CORRECCIONES DEL EDITOR A RESPUESTAS QUE YA INTEGRASTE (rehaz la parte del texto donde se uso la anterior):\n${input.corrections
            .map((c, i) => `CORRECCION ${i + 1}: ${c.question}\nANTES: ${c.previous}\nAHORA: ${c.answer}`)
            .join('\n\n')}`,
        ]
      : []),
    ...(input.sources ? [input.sources] : []),
  ].join('\n\n');
}

export async function resolvePending(input: ResolveInput): Promise<{ data: ResolveOutput; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_resolved_article',
    role: 'resolve',
    schema: ResolveOutputSchema,
    system: loadPrompt('resolve.system'),
    user: buildUserPrompt(input),
    maxTokens: cfg.AI_MAX_TOKENS,
  });
}
