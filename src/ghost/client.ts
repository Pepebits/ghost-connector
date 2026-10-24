import GhostAdminAPI from '@tryghost/admin-api';
import { request as undiciRequest } from 'undici';
import { getConfig, onConfigReload } from '../config.js';
import { ghostAuthHeaders } from './auth.js';

let apiSingleton: InstanceType<typeof GhostAdminAPI> | null = null;
onConfigReload(() => {
  apiSingleton = null;
});

/** Official client: handles JWT, versioning and image multipart. */
export function ghostApi(): InstanceType<typeof GhostAdminAPI> {
  if (apiSingleton) return apiSingleton;
  const cfg = getConfig();
  apiSingleton = new GhostAdminAPI({
    url: cfg.GHOST_API_URL,
    key: cfg.GHOST_ADMIN_API_KEY,
    version: cfg.GHOST_API_VERSION,
  });
  return apiSingleton;
}

/**
 * Low-level fallback for parameters the SDK doesn't expose in every
 * version (e.g. `source=html`, `save_revision=true` on the posts PUT).
 * Signs its own JWT per request (5-minute maximum lifetime).
 */
export async function ghostRawRequest<T = unknown>(
  path: string,
  opts: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {},
): Promise<T> {
  const cfg = getConfig();
  const url = new URL(`/ghost/api/admin${path}`, cfg.GHOST_API_URL);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, v);
  }

  const headers: Record<string, string> = {
    ...ghostAuthHeaders(cfg.GHOST_ADMIN_API_KEY, cfg.GHOST_API_VERSION),
  };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await undiciRequest(url, {
    method: (opts.method ?? 'GET') as any,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  const text = await res.body.text();
  if (res.statusCode >= 400) {
    throw new Error(`Ghost API ${opts.method ?? 'GET'} ${path} -> ${res.statusCode}: ${text}`);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}
