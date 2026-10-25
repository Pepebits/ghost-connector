import { withUsagePost } from '../agents/usage.js';
import { fixQuality } from '../agents/fix.agent.js';
import { addUsage } from '../agents/costAdd.js';
import { checkQuality, qualityInputFromPlan } from '../review/quality.js';
import { saveArtifact } from '../review/store.js';
import type { RunArtifact } from '../types.js';
import { capitalizeTitle } from '../util/title.js';
import { editPlannedArtifact } from './editPlan.js';

/** Checks the AI can fix in the text. Pending items and the image have their own tabs. */
export const AI_FIXABLE_CHECKS = new Set(['length', 'sections', 'title-length', 'keyword-title', 'keyword-intro', 'meta-title', 'meta-description']);

export function fixableProblems(plan: RunArtifact): string[] {
  return checkQuality(qualityInputFromPlan(plan))
    .checks.filter((c) => !c.ok && AI_FIXABLE_CHECKS.has(c.id))
    .map((c) => `${c.label}: ${c.detail}`);
}

export interface FixPlanResult {
  artifact: RunArtifact;
  changesMade: string[];
}

/**
 * Fixes the quality warnings of a plan NOT YET APPLIED, working on the
 * plan's own text (manual edits included). Saved like a manual edit; Ghost
 * is not touched.
 */
export async function fixPlanQuality(artifact: RunArtifact): Promise<FixPlanResult> {
  return withUsagePost(artifact.postId, async () => {
    if (artifact.status !== 'planned' || !artifact.writer) throw new Error('Only a current ("planned") plan can be fixed.');
    const problems = fixableProblems(artifact);
    if (problems.length === 0) return { artifact, changesMade: [] };
    const { data, usage } = await fixQuality({
      title: artifact.writer.title,
      markdown: artifact.writer.markdown,
      metaTitle: artifact.seo?.meta_title ?? null,
      metaDescription: artifact.seo?.meta_description ?? null,
      primaryKeyword: artifact.seo?.primary_keyword ?? null,
      language: artifact.writer.language,
      problems,
    });
    const edited = await editPlannedArtifact(artifact, {
      title: capitalizeTitle(data.title),
      markdown: data.markdown,
      ...(artifact.seo ? { meta_title: data.meta_title || artifact.seo.meta_title, meta_description: data.meta_description || artifact.seo.meta_description } : {}),
    });
    const updated: RunArtifact = {
      ...edited,
      cost: addUsage(edited.cost, usage, 'fix'),
    };
    await saveArtifact(updated);
    return { artifact: updated, changesMade: data.changes_made };
  });
}
