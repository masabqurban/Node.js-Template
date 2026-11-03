import { z } from 'zod';

const booleanFlag = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => (value === undefined ? undefined : value === 'true'));

const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Browser origins allowed by CORS. Empty = no cross-origin browser access. */
  CORS_ORIGINS: csv,
  /**
   * Reverse proxies in front of the app (load balancer, nginx…). Express then
   * reads the client IP from X-Forwarded-For. Leave 0 when clients connect
   * directly, or anyone could spoof their IP and dodge rate limits.
   */
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  JWT_ACCESS_SECRET: z.string().min(32, 'Use at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  /** scrypt work factor as a power of two. OWASP recommends 2^17; tests lower it for speed. */
  PASSWORD_HASH_COST_LOG2: z.coerce.number().int().min(10).max(20).default(17),

  /** Requests per minute per client IP, across the whole API. */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(300),
  /** Sign-in and sign-up attempts per client IP in the auth window. */
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),

  SEED_DEMO_DATA: booleanFlag,
  API_DOCS_ENABLED: booleanFlag,
});

export type Env = z.infer<typeof envSchema>;

export type Config = Env & {
  isProduction: boolean;
  seedDemoData: boolean;
  apiDocsEnabled: boolean;
};

/**
 * Validates and normalises environment variables. Pure, so tests can build a
 * config from a plain object without touching `process.env`.
 */
export function parseConfig(source: Record<string, string | undefined>): Config {
  // An empty `KEY=` line in .env means "not set", so defaults still apply.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, value]) => value !== ''));
  const env = envSchema.parse(cleaned);
  const isProduction = env.NODE_ENV === 'production';

  if (isProduction && env.SEED_DEMO_DATA) {
    throw new Error('SEED_DEMO_DATA must not be enabled in production');
  }

  return {
    ...env,
    isProduction,
    seedDemoData: env.SEED_DEMO_DATA ?? env.NODE_ENV === 'development',
    apiDocsEnabled: env.API_DOCS_ENABLED ?? !isProduction,
  };
}

/** Loads the config at startup. Exits with a readable report instead of a stack trace. */
export function loadConfig(): Config {
  try {
    return parseConfig(process.env);
  } catch (error) {
    const message = error instanceof z.ZodError ? z.prettifyError(error) : String(error);
    console.error(`Invalid configuration:\n${message}`);
    process.exit(1);
  }
}
