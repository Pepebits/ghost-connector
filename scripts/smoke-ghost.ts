import { getConfig, ghostKeyId } from '../src/config.js';
import { logger } from '../src/logger.js';
import { listDrafts } from '../src/ghost/posts.js';

async function main() {
  const cfg = getConfig();
  logger.info(
    { url: cfg.GHOST_API_URL, apiVersion: cfg.GHOST_API_VERSION, keyId: ghostKeyId(cfg.GHOST_ADMIN_API_KEY) },
    'Connecting to the Ghost Admin API',
  );

  const drafts = await listDrafts();
  logger.info({ count: drafts.length, filter: cfg.DRAFT_FILTER }, 'Drafts found');

  for (const d of drafts) {
    logger.info(
      {
        id: d.id,
        title: d.title,
        slug: d.slug,
        updated_at: d.updated_at,
        tags: d.tags.map((t) => t.name),
      },
      'draft',
    );
  }

  if (drafts.length === 0) {
    logger.warn('No drafts found. Check DRAFT_FILTER in .env or create a test one.');
  }
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'smoke-ghost failed');
  process.exit(1);
});
