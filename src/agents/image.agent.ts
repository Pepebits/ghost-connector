import { getConfig } from '../config.js';
import { ImagePlanSchema, type ImagePlan } from '../types.js';
import { loadPrompt } from './prompts.js';
import { runAgent, type AgentUsage } from './runner.js';

export interface ImageBriefInput {
  title: string;
  summary: string;
  existingFeatureImage: string | null;
  tags: string[];
}

function buildUserPrompt(input: ImageBriefInput): string {
  return [
    `TITULO: ${input.title}`,
    `RESUMEN DEL ARTICULO: ${input.summary}`,
    `TAGS: ${input.tags.join(', ') || '(ninguno)'}`,
    `FEATURE IMAGE ACTUAL: ${input.existingFeatureImage ?? '(ninguna)'}`,
  ].join('\n\n');
}

export async function planImage(input: ImageBriefInput): Promise<{ data: ImagePlan; usage: AgentUsage }> {
  const cfg = getConfig();
  return runAgent({
    name: 'submit_image_plan',
    role: 'image',
    schema: ImagePlanSchema,
    system: loadPrompt('image.system'),
    user: buildUserPrompt(input),
    maxTokens: cfg.AI_MAX_TOKENS,
  });
}
