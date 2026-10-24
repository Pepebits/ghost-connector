import { getConfig, onConfigReload } from '../config.js';

const API = 'https://api.openverse.org/v1';
const TIMEOUT_MS = 10_000;
/** Renewed a bit before expiry, so a token that expires mid-request isn't used. */
const REFRESH_MARGIN_MS = 60_000;

let cached: { token: string; expiresAt: number; clientId: string } | null = null;
onConfigReload(() => {
  cached = null;
});

export class OpenverseAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'OpenverseAuthError';
  }
}

const FIELD_LABELS: Record<string, string> = { name: 'nombre', description: 'descripcion', email: 'email' };

/**
 * Readable reason for an Openverse error. It uses two formats: `{"detail": "..."}`
 * and, on validation (400), per-field errors at the root: `{"name": ["..."]}`.
 */
export function detail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const b = body as Record<string, unknown>;
  const d = b.detail ?? b.error;
  if (typeof d === 'string') return d;
  const fields = d && typeof d === 'object' ? (d as Record<string, unknown>) : b;
  return Object.entries(fields)
    .map(([k, v]) => `${FIELD_LABELS[k] ?? k}: ${Array.isArray(v) ? v.join(' ') : String(v)}`)
    .join('; ');
}

/**
 * Registers an OAuth2 application with Openverse (once only). Openverse
 * sends a verification email: until it's confirmed, the credentials
 * have the same quota as anonymous access.
 */
export async function registerOpenverseApp(input: { name: string; description: string; email: string }): Promise<{ clientId: string; clientSecret: string; msg: string }> {
  const res = await fetch(`${API}/auth_tokens/register/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { client_id?: string; client_secret?: string; msg?: string };
  if (res.status !== 201 || !body.client_id || !body.client_secret) {
    throw new OpenverseAuthError(`Openverse rejected the registration (HTTP ${res.status})${detail(body) ? `: ${detail(body)}` : ''}`, res.status);
  }
  return { clientId: body.client_id, clientSecret: body.client_secret, msg: body.msg ?? '' };
}

/** Requests a token with client_credentials (the endpoint only accepts x-www-form-urlencoded). */
export async function requestOpenverseToken(clientId: string, clientSecret: string): Promise<{ token: string; expiresIn: number }> {
  const res = await fetch(`${API}/auth_tokens/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (res.status !== 200 || !body.access_token) {
    throw new OpenverseAuthError(`Openverse returned no token (HTTP ${res.status})${detail(body) ? `: ${detail(body)}` : ''}`, res.status);
  }
  return { token: body.access_token, expiresIn: body.expires_in ?? 3600 };
}

/**
 * Authorization header for searches, or {} if there are no credentials.
 * The token is cached in memory until shortly before it expires. If requesting it
 * fails (revoked credentials, Openverse down), it continues without a token: the
 * anonymous search works the same, just with less quota.
 */
export async function openverseAuthHeaders(opts: { forceRefresh?: boolean } = {}): Promise<Record<string, string>> {
  const cfg = getConfig();
  if (!cfg.OPENVERSE_CLIENT_ID || !cfg.OPENVERSE_CLIENT_SECRET) return {};
  const now = Date.now();
  if (!opts.forceRefresh && cached && cached.clientId === cfg.OPENVERSE_CLIENT_ID && cached.expiresAt - REFRESH_MARGIN_MS > now) {
    return { Authorization: `Bearer ${cached.token}` };
  }
  try {
    const { token, expiresIn } = await requestOpenverseToken(cfg.OPENVERSE_CLIENT_ID, cfg.OPENVERSE_CLIENT_SECRET);
    cached = { token, expiresAt: now + expiresIn * 1000, clientId: cfg.OPENVERSE_CLIENT_ID };
    return { Authorization: `Bearer ${token}` };
  } catch {
    cached = null;
    return {};
  }
}

export interface OpenverseRateLimit {
  requestsThisMinute: number | null;
  requestsToday: number | null;
  model: string;
  verified: boolean | null;
}

/** Key status (quota used and whether the email is verified), with a freshly requested token. */
export async function openverseRateLimit(token: string): Promise<OpenverseRateLimit> {
  const res = await fetch(`${API}/rate_limit/`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = (await res.json().catch(() => ({}))) as { requests_this_minute?: number | null; requests_today?: number | null; rate_limit_model?: string; verified?: boolean };
  if (res.status !== 200) throw new OpenverseAuthError(`rate_limit failed (HTTP ${res.status})${detail(body) ? `: ${detail(body)}` : ''}`, res.status);
  return {
    requestsThisMinute: body.requests_this_minute ?? null,
    requestsToday: body.requests_today ?? null,
    model: body.rate_limit_model ?? 'desconocido',
    verified: typeof body.verified === 'boolean' ? body.verified : null,
  };
}
