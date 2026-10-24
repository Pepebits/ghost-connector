import { getConfig } from '../src/config.js';
import { logger } from '../src/logger.js';
import { readDraft } from '../src/ghost/posts.js';
import { planImage } from '../src/agents/image.agent.js';
import { acquireFeatureImage } from '../src/images/pipeline.js';

async function main() {
  const cfg = getConfig();
  if (!cfg.TEST_POST_ID) throw new Error('TEST_POST_ID not set in .env.');
  if (!cfg.UNSPLASH_ACCESS_KEY) throw new Error('UNSPLASH_ACCESS_KEY not set in .env.');

  const draft = await readDraft(cfg.TEST_POST_ID);

  if (draft.feature_image) {
    logger.warn(
      { feature_image: draft.feature_image },
      'The post already has a feature image; neither the ImageAgent nor the image pipeline is called.',
    );
    return;
  }

  const { data: plan } = await planImage({
    title: draft.title,
    summary: 'Prueba del conector DeepSeek + Ghost: verificar el modulo de imagenes de punta a punta.',
    existingFeatureImage: draft.feature_image,
    tags: draft.tags.map((t) => t.name),
  });
  logger.info(plan, 'ImagePlan');

  const result = await acquireFeatureImage(plan, {
    postTitle: draft.title,
    slug: draft.slug,
    existingFeatureImage: draft.feature_image,
  });
  logger.info(result, 'Feature image uploaded to Ghost (post NOT updated yet; that is M7)');
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'test-image failed');
  process.exit(1);
});
