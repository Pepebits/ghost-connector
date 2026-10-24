import { getConfig } from '../src/config.js';
import { logger } from '../src/logger.js';
import { readDraft } from '../src/ghost/posts.js';
import { writeArticle } from '../src/agents/writer.agent.js';

// deepseek-flash, USD per 1M tokens (input/output). See api-docs.deepseek.com/quick_start/pricing
const OFF_PEAK = { input: 0.15, output: 0.6 };
const PEAK = { input: 0.3, output: 1.2 };

function estimateUsd(inputTokens: number, outputTokens: number, rates: typeof OFF_PEAK): number {
  return (inputTokens / 1_000_000) * rates.input + (outputTokens / 1_000_000) * rates.output;
}

async function main() {
  const cfg = getConfig();
  if (!cfg.TEST_POST_ID) throw new Error('TEST_POST_ID not set in .env. Run npm run seed:test-post first.');

  const draft = await readDraft(cfg.TEST_POST_ID);
  logger.info({ id: draft.id, title: draft.title }, 'Sending draft to the WriterAgent (DeepSeek)');

  const { data, usage } = await writeArticle(draft);

  logger.info(
    {
      title: data.title,
      language: data.language,
      confidence: data.confidence,
      wordCount: data.markdown.split(/\s+/).filter(Boolean).length,
      outline: data.outline,
      changes_made: data.changes_made,
    },
    'WriterOutput received',
  );
  logger.info(
    {
      ...usage,
      usd_off_peak: estimateUsd(usage.inputTokens, usage.outputTokens, OFF_PEAK).toFixed(5),
      usd_peak: estimateUsd(usage.inputTokens, usage.outputTokens, PEAK).toFixed(5),
    },
    'Token usage',
  );

  console.log('\n--- GENERATED MARKDOWN ---\n');
  console.log(data.markdown);
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'test-writer failed');
  process.exit(1);
});
