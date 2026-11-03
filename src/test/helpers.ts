import { randomUUID } from 'node:crypto';

import { pino } from 'pino';
import request from 'supertest';

import { createApp } from '../app.js';
import { parseConfig } from '../config/env.js';
import { createContainer, type Container } from '../container.js';
import type { HealthCheck } from '../modules/health/health.routes.js';
import type { UserRecord } from '../modules/users/users.repository.js';

export const PASSWORD = 'password123';

export function testConfig(overrides: Record<string, string> = {}) {
  return parseConfig({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123',
    // Cheap hashing keeps the suite fast; production uses 2^17.
    PASSWORD_HASH_COST_LOG2: '10',
    ...overrides,
  });
}

export async function addUser(
  container: Container,
  overrides: Partial<UserRecord> & { password?: string | null } = {},
): Promise<UserRecord> {
  const { password = PASSWORD, ...user } = overrides;
  return container.repositories.users.create({
    id: randomUUID(),
    name: 'Test User',
    email: `${randomUUID()}@example.com`,
    role: 'viewer',
    status: 'active',
    passwordHash: password === null ? null : await container.hasher.hash(password),
    ...user,
  });
}

/**
 * A fully isolated app per test: fresh in-memory repositories, its own rate
 * limit counters and a silent logger. Comes with an admin and a viewer.
 */
export async function createTestApp(
  options: { config?: Record<string, string>; now?: () => Date; healthChecks?: HealthCheck[] } = {},
) {
  const container = createContainer(testConfig(options.config), {
    logger: pino({ level: 'silent' }),
    ...(options.now ? { now: options.now } : {}),
    ...(options.healthChecks ? { healthChecks: options.healthChecks } : {}),
  });
  const app = createApp(container);
  const api = () => request(app);

  const admin = await addUser(container, {
    name: 'Ada Admin',
    email: 'admin@example.com',
    role: 'admin',
  });
  const viewer = await addUser(container, { name: 'Vic Viewer', email: 'viewer@example.com' });

  /** Signs in through the real endpoint and returns the session. */
  async function login(email: string, password = PASSWORD) {
    const res = await api().post('/api/v1/auth/login').send({ email, password }).expect(200);
    const session = res.body.data as { accessToken: string; refreshToken: string };
    return { ...session, auth: { Authorization: `Bearer ${session.accessToken}` } };
  }

  return { app, api, container, admin, viewer, login };
}
