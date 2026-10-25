import { getConfig } from '../src/config.js';
import { logger } from '../src/logger.js';
import { readDraft } from '../src/ghost/posts.js';
import { writeArticle } from '../src/agents/writer.agent.js';
import { planSeo } from '../src/agents/seo.agent.js';
import { planImage } from '../src/agents/image.agent.js';
import type { AgentUsage } from '../src/agents/runner.js';

const OFF_PEAK = { input: 0.15, output: 0.6 };

function usd(u: AgentUsage): number {
  return (u.inputTokens / 1_000_000) * OFF_PEAK.input + (u.outputTokens / 1_000_000) * OFF_PEAK.output;
}

async function main() {
  const cfg = getConfig();
  if (!cfg.TEST_POST_ID) throw new Error('TEST_POST_ID not set in .env.');

  const draft = await readDraft(cfg.TEST_POST_ID);
  logger.info({ id: draft.id, title: draft.title }, 'Step 1/3: WriterAgent');
  const writer = await writeArticle(draft);

  logger.info('Step 2/3: SeoAgent + ImageAgent in parallel');
  const [seo, image] = await Promise.all([
    planSeo({
      title: writer.data.title,
      markdown: writer.data.markdown,
      existingTags: draft.tags.map((t) => t.name),
      currentSlug: draft.slug,
    }),
    planImage({
      language: writer.data.language,
      title: writer.data.title,
      summary: writer.data.summary,
      existingFeatureImage: draft.feature_image,
      tags: draft.tags.map((t) => t.name),
    }),
  ]);

  logger.info(seo.data, 'SeoOutput');
  logger.info(image.data, 'ImagePlan');

  const totalUsd = usd(writer.usage) + usd(seo.usage) + usd(image.usage);
  logger.info(
    { writer: writer.usage, seo: seo.usage, image: image.usage, total_usd_off_peak: totalUsd.toFixed(5) },
    'Token usage (3 agents)',
  );
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'test-pipeline failed');
  process.exit(1);
});
