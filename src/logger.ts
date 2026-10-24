import pino from 'pino';
import { getConfig } from './config.js';

const REDACT_PATHS = [
  'GHOST_ADMIN_API_KEY',
  'AI_API_KEY',
  'DEEPSEEK_API_KEY',
  'UNSPLASH_ACCESS_KEY',
  'IMAGE_GENERATION_API_KEY',
  'OPENVERSE_CLIENT_SECRET',
  '*.OPENVERSE_CLIENT_SECRET',
  '*.GHOST_ADMIN_API_KEY',
  '*.AI_API_KEY',
  '*.DEEPSEEK_API_KEY',
  '*.UNSPLASH_ACCESS_KEY',
  '*.IMAGE_GENERATION_API_KEY',
  'config.GHOST_ADMIN_API_KEY',
];

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
    transport: {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    },
  });
}

export const logger = buildLogger();
