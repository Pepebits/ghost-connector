import type { ImagePlan } from '../types.js';
import type { ImageCandidate, ImageProvider } from './provider.js';

export class UnsupportedProviderError extends Error {}

/**
 * Swappable placeholder for AI image generation. Any
 * text-to-image provider only needs to implement `acquire()` and
 * return {buffer, contentType, filename, sourceUrl, attribution}. Details
 * any new provider will need: endpoint, prompt field, and
 * response format (URL to download vs. inline base64).
 */
export class GeneratedProvider implements ImageProvider {
  readonly name = 'generated';

  supports(strategy: ImagePlan['strategy']): boolean {
    return strategy === 'generate';
  }

  async acquire(): Promise<ImageCandidate | null> {
    throw new UnsupportedProviderError(
      'IMAGE_GENERATION_PROVIDER=none: no generation provider configured.',
    );
  }
}
