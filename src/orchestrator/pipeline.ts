import type { AgentUsage } from '../agents/runner.js';
import { internalLinksBlock, relatedPosts } from '../research/internalLinks.js';
import { capitalizeTitle } from '../util/title.js';
import { planImage } from '../agents/image.agent.js';
import { planSeo } from '../agents/seo.agent.js';
import { writeArticle, type WriterMode } from '../agents/writer.agent.js';
import { logger } from '../logger.js';
import type { CostAgent, DraftSnapshot, ImagePlan, RunArtifact, SeoOutput, WriterOutput } from '../types.js';
import { buildPostPatch } from './merge.js';
import { searchImageOptions } from '../images/pipeline.js';
import { readSources, sourcesBlock } from '../research/sources.js';

/**
 * Accumulates tokens and cost of a post's calls. Each agent may use
 * a different model (and price); if any has no price, the run's cost
 * is marked incomplete instead of silently counting it as 0.
 */
class CostTally {
  inputTokens = 0;
  outputTokens = 0;
  private usdSum = 0;
  private unpriced = new Set<string>();
  private byAgent: Partial<Record<CostAgent, number>> = {};
  add(u: AgentUsage, agent: CostAgent): void {
    this.inputTokens += u.inputTokens;
    this.outputTokens += u.outputTokens;
    if (u.usd === null) this.unpriced.add(u.model);
    else {
      this.usdSum += u.usd;
      this.byAgent[agent] = (this.byAgent[agent] ?? 0) + u.usd;
    }
  }
  toCost(): RunArtifact['cost'] {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      usd: this.usdSum,
      ...(this.unpriced.size ? { unpricedModels: [...this.unpriced] } : {}),
      byAgent: this.byAgent,
    };
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export interface ProcessOptions {
  /** One-off editor instructions for this plan (see writer.agent.ts). */
  extraInstructions?: string;
  /** Receives the WriterAgent's partial `arguments` while it writes (streaming), for the live view. */
  onWriterPartial?: (partialArgs: string) => void;
  /** Complete draft / improve an already finished version (auto-detected by default). */
  mode?: WriterMode;
}

/**
 * Each stage can fail without taking down the whole post, except the writer: without
 * content there's nothing to write SEO for or pick an image for. Other
 * failures are recorded in `errors` and the patch is applied anyway with whatever
 * could be generated.
 */
export async function processDraft(runId: string, snapshot: DraftSnapshot, opts: ProcessOptions = {}): Promise<RunArtifact> {
  const errors: RunArtifact['errors'] = [];
  const tally = new CostTally();

  const base = {
    runId,
    postId: snapshot.id,
    postTitle: snapshot.title,
    createdAt: new Date().toISOString(),
    snapshot,
    extraInstructions: opts.extraInstructions,
  };

  // The editor's URLs are read first: the writer doesn't browse.
  const read = opts.extraInstructions ? await readSources(opts.extraInstructions) : [];
  const sources = read.length ? read.map((r) => ({ url: r.url, ok: r.ok, ...(r.ok ? {} : { note: r.text }), ...(r.suspicious ? { suspicious: true } : {}) })) : undefined;
  // Related posts already published: the writer may link them (and the link check knows them).
  const related = await relatedPosts(snapshot, opts.extraInstructions);
  const known = [...read.flatMap((r) => (r.ok ? [r.url, ...r.links] : [r.url])), ...related.map((p) => p.url)];
  const allowedLinks = known.length ? [...new Set(known)] : undefined;
  const writerSources = [sourcesBlock(read), internalLinksBlock(related)].filter(Boolean).join('\n\n');

  let writer: WriterOutput;
  try {
    const res = await writeArticle(snapshot, opts.extraInstructions, opts.onWriterPartial, opts.mode, writerSources || undefined);
    writer = { ...res.data, title: capitalizeTitle(res.data.title) };
    tally.add(res.usage, 'writer');
  } catch (err) {
    logger.error({ id: snapshot.id, err: errMsg(err) }, 'WriterAgent failed; dropping the post from this run');
    return {
      ...base,
      sources,
      allowedLinks,
      writer: null,
      seo: null,
      imagePlan: null,
      uploadedImage: null,
      patch: { status: 'draft' },
      cost: tally.toCost(),
      errors: [{ stage: 'writer', message: errMsg(err) }],
      status: 'failed',
    };
  }

  const [seoSettled, imageSettled] = await Promise.allSettled([
    planSeo({
      title: writer.title,
      markdown: writer.markdown,
      existingTags: snapshot.tags.map((t) => t.name),
      currentSlug: snapshot.slug,
      language: writer.language,
    }),
    snapshot.feature_image
      ? Promise.resolve(null)
      : planImage({
          language: writer.language,
          title: writer.title,
          summary: writer.summary,
          existingFeatureImage: snapshot.feature_image,
          tags: snapshot.tags.map((t) => t.name),
        }),
  ]);

  let seo: SeoOutput | null = null;
  if (seoSettled.status === 'fulfilled') {
    seo = seoSettled.value.data;
    tally.add(seoSettled.value.usage, 'seo');
  } else {
    errors.push({ stage: 'seo', message: errMsg(seoSettled.reason) });
  }

  let imagePlan: ImagePlan | null = null;
  if (imageSettled.status === 'fulfilled' && imageSettled.value) {
    imagePlan = imageSettled.value.data;
    tally.add(imageSettled.value.usage, 'image');
  } else if (imageSettled.status === 'rejected') {
    errors.push({ stage: 'image-plan', message: errMsg(imageSettled.reason) });
  }

  // Image candidates: only SEARCHED (metadata and thumbnails) so the
  // editor can pick one in the UI. Nothing is downloaded or uploaded to Ghost here.
  let imageOptions: RunArtifact['imageOptions'];
  if (imagePlan && imagePlan.strategy !== 'skip' && !snapshot.feature_image) {
    try {
      const found = await searchImageOptions(imagePlan.unsplash_query || imagePlan.generation_prompt || writer.title, imagePlan.orientation);
      imageOptions = { ...found, at: new Date().toISOString() };
    } catch (err) {
      errors.push({ stage: 'image-search', message: errMsg(err) });
    }
  }
  const { patch, contentSource } = buildPostPatch({ snapshot, writer, seo, uploadedImage: null });

  return {
    ...base,
    sources,
    allowedLinks,
    imageOptions,
    postTitle: writer.title,
    writer,
    seo,
    imagePlan,
    uploadedImage: null,
    patch,
    contentSource,
    cost: tally.toCost(),
    errors,
    status: 'planned',
  };
}
