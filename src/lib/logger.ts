import { createRequire } from 'node:module';

import { pino, type Logger } from 'pino';

import type { Config } from '../config/env.js';

/** pino-pretty is a dev dependency, so it is absent from production images. */
function hasPinoPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Structured JSON logs in production (ready for Datadog, Loki, CloudWatch…),
 * readable colour output in development. Credentials are always redacted.
 */
export function createLogger(config: Pick<Config, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const pretty = config.NODE_ENV === 'development' && hasPinoPretty();
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.refreshToken',
        '*.accessToken',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } } }
      : {}),
  });
}

export type { Logger };
