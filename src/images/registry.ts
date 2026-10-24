import { getConfig, IMAGE_SOURCES, type ImageSource } from '../config.js';
import type { ImagePlan } from '../types.js';
import { GeneratedProvider } from './generated.provider.js';
import { OpenverseProvider } from './openverse.provider.js';
import { PexelsProvider } from './pexels.provider.js';
import { PixabayProvider } from './pixabay.provider.js';
import type { ImageProvider, StockSource } from './provider.js';
import { StockPhotoProvider } from './stock.provider.js';
import { UnsplashProvider } from './unsplash.provider.js';
import { WikimediaProvider } from './wikimedia.provider.js';

const STOCK_SOURCES: Record<ImageSource, StockSource> = {
  unsplash: new UnsplashProvider(),
  pixabay: new PixabayProvider(),
  pexels: new PexelsProvider(),
  openverse: new OpenverseProvider(),
  wikimedia: new WikimediaProvider(),
};

const providers: ImageProvider[] = [
  // The order comes from IMAGE_SOURCES_ORDER on each acquisition: it can be changed from Settings without restarting.
  new StockPhotoProvider(() => stockSources()),
  new GeneratedProvider(),
];

export function resolveProvider(strategy: ImagePlan['strategy']): ImageProvider | null {
  if (strategy === 'skip') return null;
  return providers.find((p) => p.supports(strategy)) ?? null;
}

/**
 * Stock sources in the configured order (IMAGE_SOURCES_ORDER). Sources missing
 * from it (a saved order from before a source existed) go last, so adding
 * a key is enough to use it.
 */
export function stockSources(): StockSource[] {
  const order = getConfig().IMAGE_SOURCES_ORDER as ImageSource[];
  const all = [...order, ...IMAGE_SOURCES.filter((s) => !order.includes(s))];
  return all.map((name) => STOCK_SOURCES[name]);
}

/** Sources in the configured order that have their key (or are enabled): the rest are left out. */
export function configuredSources(): StockSource[] {
  const cfg = getConfig();
  const ready: Record<ImageSource, boolean> = {
    unsplash: !!cfg.UNSPLASH_ACCESS_KEY,
    pixabay: !!cfg.PIXABAY_API_KEY,
    pexels: !!cfg.PEXELS_API_KEY,
    openverse: !!cfg.OPENVERSE_ENABLED,
    wikimedia: !!cfg.WIKIMEDIA_ENABLED,
  };
  return stockSources().filter((s) => ready[s.name as ImageSource]);
}

export function stockSource(name: string): StockSource | null {
  return STOCK_SOURCES[name as ImageSource] ?? null;
}
