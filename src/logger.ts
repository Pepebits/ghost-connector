import pino from 'pino';
import { getConfig } from './config.js';

/** Every key that must never reach a log (tests/logger.test.ts checks it covers all secret settings). */
export const SECRET_KEYS = [
  'GHOST_ADMIN_API_KEY',
  'AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'UNSPLASH_ACCESS_KEY',
  'PIXABAY_API_KEY',
  'PEXELS_API_KEY',
  'OPENVERSE_CLIENT_SECRET',
  'GSC_SERVICE_ACCOUNT',
  'BING_API_KEY',
  'GITHUB_TOKEN',
  'WEB_SESSION_TOKEN',
  'IMAGE_GENERATION_API_KEY',
];

const REDACT_PATHS = [
  ...SECRET_KEYS.flatMap((k) => [k, `*.${k}`, `*.*.${k}`]),
  // Request/response headers that carry credentials, wherever they get logged.
  ...['authorization', 'cookie', 'set-cookie', 'x-api-key', 'proxy-authorization'].flatMap((h) => [`headers.${h}`, `*.headers.${h}`, `*.*.headers.${h}`, `headers["${h}"]`]),
  'password',
  '*.password',
];

/** Login tokens travel in the query (?t=, ?once=): never written to the logs. */
export function scrubUrl(url: string): string {
  return url.replace(/([?&](?:t|once|token)=)[^&#]*/gi, '$1[REDACTED]').replace(/^(\/invite\/)[^/?#]+/, '$1[REDACTED]');
}

function requestSerializer(req: { method?: string; url?: string; headers?: Record<string, unknown>; host?: string; hostname?: string; ip?: string; socket?: { remoteAddress?: string } }) {
  return {
    method: req.method,
    url: scrubUrl(String(req.url ?? '')),
    host: req.host ?? req.hostname ?? req.headers?.host,
    remoteAddress: req.ip ?? req.socket?.remoteAddress,
  };
}

function buildLogger() {
  const level = (() => {
    try {
      return getConfig().LOG_LEVEL;
    } catch {
      return 'info';
    }
  })();

  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
    serializers: { req: requestSerializer },
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  });
}

export const logger = buildLogger();
