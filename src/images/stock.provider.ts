import { logger } from '../logger.js';
import type { ImagePlan } from '../types.js';
import type { ImageCandidate, ImageProvider } from './provider.js';

/**
 * Tries several stock sources in order and uses the first one that returns
 * a result. Order: Unsplash (50 req/h in Demo mode) -> Pexels (200 req/h) ->
 * Openverse (no key, 200/day, CC licenses) when the previous ones have no
 * key, run out of quota or find nothing.
 */
export class StockPhotoProvider implements ImageProvider {
  readonly name = 'stock';

  /** A fixed list, or a function that resolves it on each call (order configurable on the fly). */
  constructor(private readonly sourcesOf: ImageProvider[] | (() => ImageProvider[])) {}

  private get sources(): ImageProvider[] {
    return typeof this.sourcesOf === 'function' ? this.sourcesOf() : this.sourcesOf;
  }

  supports(strategy: ImagePlan['strategy']): boolean {
    return this.sources.some((s) => s.supports(strategy));
  }

  async acquire(plan: ImagePlan, ctx: { postTitle: string }): Promise<ImageCandidate | null> {
    for (const source of this.sources) {
      try {
        const result = await source.acquire(plan, ctx);
        if (result) return result;
      } catch (err) {
        logger.warn(
          { provider: source.name, err: err instanceof Error ? err.message : String(err) },
          'Stock provider failed; trying the next one',
        );
      }
    }
    return null;
  }
}
