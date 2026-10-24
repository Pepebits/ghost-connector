import sanitizeHtml from 'sanitize-html';
import type { RunArtifact } from '../types.js';
import { findPendingMarkers } from '../util/pending.js';

function plainText(html: string | null): string {
  if (!html) return '';
  return sanitizeHtml(html, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, ' ').trim();
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Readable plain-text diff for human review before `apply` (M7). */
export function renderDiff(artifact: RunArtifact): string {
  const { snapshot, writer, seo, uploadedImage, imagePlan, patch, errors, cost } = artifact;
  const lines: string[] = [];

  lines.push(`=== ${snapshot.title}  (${snapshot.id})  [${artifact.status}] ===`);
  const unpriced = cost.unpricedModels?.length ? `  · no price for ${cost.unpricedModels.join(', ')} (AI_PRICES)` : '';
  lines.push(`estimated cost: $${cost.usd.toFixed(5)}  (in=${cost.inputTokens} out=${cost.outputTokens})${unpriced}`);
  lines.push('');

  if (patch.title && patch.title !== snapshot.title) {
    lines.push('TITLE:');
    lines.push(`  before:   ${snapshot.title}`);
    lines.push(`  after:    ${patch.title}`);
    lines.push('');
  }

  if (writer) {
    const before = wordCount(plainText(snapshot.html));
    const after = wordCount(writer.markdown);
    lines.push(`BODY: ${before} words -> ${after} words`);
    if (writer.changes_made.length > 0) {
      lines.push('  changes declared by the writer:');
      for (const c of writer.changes_made) lines.push(`   - ${c}`);
    }
    const pending = findPendingMarkers(writer.markdown);
    if (pending.length > 0) {
      lines.push(`  *** ${pending.length} unresolved [[PENDING:]] marker(s): ***`);
      for (const p of pending) lines.push(`   - ${p}`);
    }
    lines.push('');
  }

  if (seo) {
    lines.push('SEO:');
    lines.push(`  meta_title:       ${snapshot.meta_title ?? '(empty)'}  ->  ${seo.meta_title}`);
    lines.push(`  meta_description: ${snapshot.meta_description ?? '(empty)'}  ->  ${seo.meta_description}`);
    lines.push(`  custom_excerpt:   ${snapshot.custom_excerpt ?? '(empty)'}  ->  ${seo.custom_excerpt}`);
    lines.push(
      `  slug:             ${snapshot.slug}${patch.slug ? `  ->  ${patch.slug}` : '  (no change; ALLOW_SLUG_CHANGE=false or no difference)'}`,
    );
    lines.push(`  new tags:         ${seo.tags.join(', ') || '(none)'}`);
    if (seo.keyword_notes.length > 0) {
      lines.push('  keyword_notes:');
      for (const n of seo.keyword_notes) lines.push(`   - ${n}`);
    }
    lines.push('');
  }

  if (uploadedImage) {
    // Only happens if this artifact already went through `apply` (plan never uploads images).
    lines.push('IMAGE (uploaded):');
    lines.push(`  url:     ${uploadedImage.url}`);
    lines.push(`  alt:     ${uploadedImage.alt}`);
    lines.push(`  caption: ${uploadedImage.caption ?? '(none)'}`);
    lines.push('');
  } else if (snapshot.feature_image) {
    lines.push(`IMAGE: keeping the existing one (${snapshot.feature_image})`);
    lines.push('');
  } else if (imagePlan && imagePlan.strategy !== 'skip') {
    lines.push('IMAGE (plan, resolved and uploaded only on "apply"):');
    lines.push(`  strategy: ${imagePlan.strategy}`);
    if (imagePlan.unsplash_query) lines.push(`  unsplash_query: ${imagePlan.unsplash_query}`);
    if (imagePlan.generation_prompt) lines.push(`  generation_prompt: ${imagePlan.generation_prompt}`);
    lines.push(`  alt_text: ${imagePlan.alt_text}`);
    lines.push(`  reason: ${imagePlan.reasoning}`);
    lines.push('');
  } else if (imagePlan) {
    lines.push(`IMAGE: the agent chose "skip" (${imagePlan.reasoning})`);
    lines.push('');
  }

  if (errors.length > 0) {
    lines.push('ERRORS / DEGRADATIONS:');
    for (const e of errors) lines.push(`  [${e.stage}] ${e.message}`);
    lines.push('');
  }

  return lines.join('\n');
}
