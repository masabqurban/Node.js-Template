import type { Config } from './config/env.js';
import { createPasswordHasher } from './lib/crypto.js';
import { createAccessTokens } from './lib/jwt.js';
import { createLogger, type Logger } from './lib/logger.js';
import { createAuthService } from './modules/auth/auth.service.js';
import {
  createInMemorySessionRepository,
  type SessionRepository,
} from './modules/auth/session.repository.js';
import { createDashboardService } from './modules/dashboard/dashboard.service.js';
import type { HealthCheck } from './modules/health/health.routes.js';
import {
  createInMemoryUserRepository,
  type UserRepository,
} from './modules/users/users.repository.js';
import { createUsersService } from './modules/users/users.service.js';
import { createMemoryRateLimitStore, type RateLimitStore } from './shared/rate-limit/rate-limit.js';

export type Repositories = {
  users: UserRepository;
  sessions: SessionRepository;
};

type ContainerOverrides = {
  logger?: Logger;
  repositories?: Partial<Repositories>;
  rateLimitStore?: RateLimitStore;
  healthChecks?: HealthCheck[];
  now?: () => Date;
};

/**
 * Composition root: the one place that decides which implementation backs
 * each dependency. Swapping storage (Prisma, Drizzle, Mongo…) or the rate
 * limit store (Redis) happens here; services and routes don't change.
 * Tests call it with overrides to get a fully isolated app.
 */
export function createContainer(config: Config, overrides: ContainerOverrides = {}) {
  const now = overrides.now ?? (() => new Date());
  const logger = overrides.logger ?? createLogger(config);

  const repositories: Repositories = {
    users: overrides.repositories?.users ?? createInMemoryUserRepository(now),
    sessions: overrides.repositories?.sessions ?? createInMemorySessionRepository(),
  };

  const hasher = createPasswordHasher(config.PASSWORD_HASH_COST_LOG2);
  const tokens = createAccessTokens(config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SECONDS);

  const auth = createAuthService({
    users: repositories.users,
    sessions: repositories.sessions,
    hasher,
    tokens,
    refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
    logger,
    now,
  });

  const services = {
    auth,
    users: createUsersService({
      users: repositories.users,
      revokeSessions: (userId) => auth.revokeUserSessions(userId),
    }),
    dashboard: createDashboardService({ users: repositories.users, now }),
  };

  return {
    config,
    logger,
    now,
    hasher,
    repositories,
    services,
    rateLimitStore: overrides.rateLimitStore ?? createMemoryRateLimitStore(),
    // In-memory storage is always ready. Add a check per real dependency, e.g.
    // { name: 'database', check: () => prisma.$queryRaw`SELECT 1` }.
    healthChecks: overrides.healthChecks ?? [],
    /** Release connections (database pools, Redis…) on shutdown. */
    async dispose() {
      // Nothing to close for in-memory storage.
    },
  };
}

export type Container = ReturnType<typeof createContainer>;
