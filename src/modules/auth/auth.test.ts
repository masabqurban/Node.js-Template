import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';

import { createContainer } from '../../container.js';
import { createPasswordHasher, sha256 } from '../../lib/crypto.js';
import { createAccessTokens } from '../../lib/jwt.js';
import { AppError } from '../../shared/errors/app-error.js';
import { addUser, createTestApp, PASSWORD, testConfig } from '../../test/helpers.js';
import type { UserRepository } from '../users/users.repository.js';
import { createAuthService } from './auth.service.js';
import { createInMemorySessionRepository } from './session.repository.js';

describe('POST /auth/register', () => {
  it('creates an active viewer and signs them in', async () => {
    const { api } = await createTestApp();
    const res = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Grace Hopper', email: 'Grace@Example.com', password: 'a-long-password' })
      .expect(201);

    expect(res.body.data.user).toMatchObject({
      email: 'grace@example.com',
      role: 'viewer',
      status: 'active',
    });
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
    // Response schemas filter output, so credentials can never leak.
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|scrypt/);
  });

  it('rejects a taken email and a weak password', async () => {
    const { api } = await createTestApp();
    const taken = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Copy Cat', email: 'admin@example.com', password: 'a-long-password' })
      .expect(409);
    expect(taken.body.error).toMatchObject({ code: 'EMAIL_TAKEN', details: { field: 'email' } });

    const weak = await api()
      .post('/api/v1/auth/register')
      .send({ name: 'Weak', email: 'weak@example.com', password: 'short' })
      .expect(400);
    expect(weak.body.error.code).toBe('VALIDATION_ERROR');
    expect(weak.body.error.details).toEqual([
      { path: 'password', message: 'Use at least 8 characters.' },
    ]);
  });
});

describe('POST /auth/login', () => {
  it('signs in with a case-insensitive email', async () => {
    const { api } = await createTestApp();
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ADMIN@example.com', password: PASSWORD })
      .expect(200);
    expect(res.body.data.user).toMatchObject({ role: 'admin', lastActiveAt: expect.any(String) });
  });

  it('gives the same answer for a wrong password and an unknown email', async () => {
    const { api } = await createTestApp();
    const wrong = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: 'nope' });
    const unknown = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@example.com', password: 'nope' });

    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toEqual(unknown.body.error);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('refuses suspended accounts', async () => {
    const { api, container } = await createTestApp();
    await addUser(container, { email: 'gone@example.com', status: 'suspended' });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'gone@example.com', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_INACTIVE');
  });

  it('rate-limits attempts per IP', async () => {
    const { api } = await createTestApp({ config: { AUTH_RATE_LIMIT_MAX: '3' } });
    for (let i = 0; i < 3; i++) {
      await api()
        .post('/api/v1/auth/login')
        .send({ email: 'x@example.com', password: 'nope' })
        .expect(401);
    }
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'admin@example.com', password: PASSWORD });

    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('TOO_MANY_REQUESTS');
    expect(res.headers['retry-after']).toMatch(/^\d+$/);
    expect(res.headers['ratelimit-remaining']).toBe('0');
  });
});

describe('access tokens', () => {
  it('protects routes and rejects tampered or expired tokens', async () => {
    const { api, login, admin } = await createTestApp();
    const { auth, accessToken } = await login('admin@example.com');

    await api().get('/api/v1/me').set(auth).expect(200);
    expect((await api().get('/api/v1/me')).body.error.code).toBe('UNAUTHORIZED');

    const tampered = `${accessToken.slice(0, -2)}xx`;
    const bad = await api().get('/api/v1/me').set('Authorization', `Bearer ${tampered}`);
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('TOKEN_INVALID');

    const config = testConfig();
    const stale = await createAccessTokens(config.JWT_ACCESS_SECRET, 60).sign(
      { sub: admin.id, sid: 'any', role: 'admin' },
      new Date(Date.now() - 3_600_000),
    );
    const expired = await api().get('/api/v1/me').set('Authorization', `Bearer ${stale.token}`);
    expect(expired.body.error.code).toBe('TOKEN_INVALID');
  });
});

describe('POST /auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const { api, login } = await createTestApp();
    const first = await login('viewer@example.com');

    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(res.body.data.refreshToken).not.toBe(first.refreshToken);

    await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${res.body.data.accessToken}`)
      .expect(200);
  });

  it('treats reuse of an old token as theft and ends the whole session', async () => {
    const { api, login } = await createTestApp();
    const first = await login('viewer@example.com');
    const rotated = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });

    const replay = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');

    // The legitimate holder's newer tokens are revoked too.
    const next = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken });
    expect(next.body.error.code).toBe('TOKEN_REUSED');
    const me = await api()
      .get('/api/v1/me')
      .set('Authorization', `Bearer ${rotated.body.data.accessToken}`);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
  });

  it('rejects unknown tokens', async () => {
    const { api } = await createTestApp();
    const res = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'made-up' })
      .expect(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('returns TOKEN_EXPIRED on expired unrevoked tokens and retries without triggering TOKEN_REUSED', async () => {
    let currentTime = new Date('2026-01-01T00:00:00Z');
    const logger = pino({ level: 'silent' });
    const warnSpy = vi.spyOn(logger, 'warn');
    const container = createContainer(testConfig({ REFRESH_TOKEN_TTL_DAYS: '1' }), {
      logger,
      now: () => currentTime,
    });
    await addUser(container, { email: 'viewer@example.com', role: 'viewer' });

    const session = await container.services.auth.login({
      email: 'viewer@example.com',
      password: PASSWORD,
    });

    currentTime = new Date('2026-01-02T00:00:01Z');

    await expect(container.services.auth.refresh(session.refreshToken)).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    // Retry with the same expired token must still return TOKEN_EXPIRED, not TOKEN_REUSED.
    await expect(container.services.auth.refresh(session.refreshToken)).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_EXPIRED',
    });
    expect(warnSpy).not.toHaveBeenCalled();

    const stored = await container.repositories.sessions.findByTokenHash(
      sha256(session.refreshToken),
    );
    expect(stored?.revokedAt).toBeNull();
  });

  it('treats an already-revoked token as TOKEN_REUSED even if it is also expired', async () => {
    let currentTime = new Date('2026-01-01T00:00:00Z');
    const { api, login, container } = await createTestApp({
      config: { REFRESH_TOKEN_TTL_DAYS: '1' },
      now: () => currentTime,
    });
    const first = await login('viewer@example.com');
    const storedFirst = await container.repositories.sessions.findByTokenHash(
      sha256(first.refreshToken),
    );

    // Rotate 12 hours later so `rotated` outlives `first`.
    currentTime = new Date('2026-01-01T12:00:00Z');
    const rotated = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);

    // Advance past `first`'s expiry while `rotated` is still unexpired.
    currentTime = new Date('2026-01-02T00:00:01Z');
    const replay = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);
    expect(replay.body.error.code).toBe('TOKEN_REUSED');

    expect(
      await container.repositories.sessions.isFamilyActive(storedFirst!.familyId, currentTime),
    ).toBe(false);
    expect(
      await container.repositories.sessions.isFamilyRevoked(storedFirst!.familyId, currentTime),
    ).toBe(true);

    const after = await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body.data.refreshToken })
      .expect(401);
    expect(after.body.error.code).toBe('TOKEN_REUSED');
  });

  it('prevents concurrent refresh races from leaving an active session in a revoked family', async () => {
    const { api, login, container } = await createTestApp();
    const initial = await login('viewer@example.com');
    const initialRecord = await container.repositories.sessions.findByTokenHash(
      sha256(initial.refreshToken),
    );

    const [resA, resB] = await Promise.all([
      api().post('/api/v1/auth/refresh').send({ refreshToken: initial.refreshToken }),
      api().post('/api/v1/auth/refresh').send({ refreshToken: initial.refreshToken }),
    ]);

    const statuses = [resA.status, resB.status];
    expect(statuses).toContain(401);
    const failed = resA.status === 401 ? resA : resB;
    expect(['TOKEN_REUSED', 'SESSION_REVOKED']).toContain(failed.body.error.code);

    // Regardless of HTTP scheduling order, the family must now be completely inactive.
    expect(
      await container.repositories.sessions.isFamilyActive(initialRecord!.familyId, new Date()),
    ).toBe(false);

    const winner = resA.status === 200 ? resA : resB.status === 200 ? resB : null;
    if (winner) {
      const me = await api()
        .get('/api/v1/me')
        .set('Authorization', `Bearer ${winner.body.data.accessToken}`);
      expect(me.status).toBe(401);
      expect(me.body.error.code).toBe('SESSION_REVOKED');
    }
  });

  it('closes the TOCTOU window when revokeFamily completes between revoke and create', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const config = testConfig();
    const baseContainer = createContainer(config, { now: () => now });
    const user = await addUser(baseContainer, { email: 'race@example.com', role: 'viewer' });

    let hookFindById = false;
    let enteredFindById!: () => void;
    const findByIdStarted = new Promise<void>((resolve) => {
      enteredFindById = resolve;
    });
    let releasePromiseResolver!: () => void;

    const racingUsers: UserRepository = {
      ...baseContainer.repositories.users,
      async findById(id) {
        if (hookFindById) {
          hookFindById = false;
          enteredFindById();
          await new Promise<void>((resolve) => {
            releasePromiseResolver = resolve;
          });
        }
        return baseContainer.repositories.users.findById(id);
      },
    };

    const sessions = createInMemorySessionRepository(() => now);
    const logger = pino({ level: 'silent' });
    const auth = createAuthService({
      users: racingUsers,
      sessions,
      hasher: createPasswordHasher(config.PASSWORD_HASH_COST_LOG2),
      tokens: createAccessTokens(config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
      logger,
      now: () => now,
    });

    const loginResult = await auth.login({ email: user.email, password: PASSWORD });
    const originalSession = await sessions.findByTokenHash(sha256(loginResult.refreshToken));

    // Arm the pause only for Request A's `users.findById` call.
    hookFindById = true;
    const reqA = auth.refresh(loginResult.refreshToken);

    // Wait until Request A has atomically revoked the token and yielded in `users.findById`.
    await findByIdStarted;

    // Request B arrives with the same token, fails `revoke()`, and revokes the whole family.
    await expect(auth.refresh(loginResult.refreshToken)).rejects.toMatchObject({
      status: 401,
      code: 'TOKEN_REUSED',
    });

    // Release Request A so it attempts `issueSession` (`sessions.create`) on the revoked family.
    releasePromiseResolver();
    await expect(reqA).rejects.toThrow(AppError);
    await expect(reqA).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });

    expect(await sessions.isFamilyActive(originalSession!.familyId, now)).toBe(false);
    expect(await sessions.isFamilyRevoked(originalSession!.familyId, now)).toBe(true);
  });

  it('rejects refresh if the family is revoked during token signing or user update', async () => {
    const now = new Date('2026-01-01T00:00:00Z');
    const config = testConfig();
    const baseContainer = createContainer(config, { now: () => now });
    const user = await addUser(baseContainer, { email: 'logout-race@example.com', role: 'viewer' });

    let hookUpdate = false;
    let enteredUpdate!: () => void;
    const updateStarted = new Promise<void>((resolve) => {
      enteredUpdate = resolve;
    });
    let releaseUpdate!: () => void;

    const racingUsers: UserRepository = {
      ...baseContainer.repositories.users,
      async update(id, patch) {
        if (hookUpdate) {
          hookUpdate = false;
          enteredUpdate();
          await new Promise<void>((resolve) => {
            releaseUpdate = resolve;
          });
        }
        return baseContainer.repositories.users.update(id, patch);
      },
    };

    const sessions = createInMemorySessionRepository(() => now);
    const auth = createAuthService({
      users: racingUsers,
      sessions,
      hasher: createPasswordHasher(config.PASSWORD_HASH_COST_LOG2),
      tokens: createAccessTokens(config.JWT_ACCESS_SECRET, config.ACCESS_TOKEN_TTL_SECONDS),
      refreshTokenTtlDays: config.REFRESH_TOKEN_TTL_DAYS,
      logger: pino({ level: 'silent' }),
      now: () => now,
    });

    const loginResult = await auth.login({ email: user.email, password: PASSWORD });
    const originalSession = await sessions.findByTokenHash(sha256(loginResult.refreshToken));

    hookUpdate = true;
    const refreshPromise = auth.refresh(loginResult.refreshToken);
    await updateStarted;

    await auth.logout(loginResult.refreshToken);
    releaseUpdate();

    await expect(refreshPromise).rejects.toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
    expect(await sessions.isFamilyActive(originalSession!.familyId, now)).toBe(false);
  });
});

describe('POST /auth/logout', () => {
  it('ends the session immediately, including its access token', async () => {
    const { api, login } = await createTestApp();
    const session = await login('viewer@example.com');

    await api()
      .post('/api/v1/auth/logout')
      .send({ refreshToken: session.refreshToken })
      .expect(204);

    const me = await api().get('/api/v1/me').set(session.auth);
    expect(me.body.error.code).toBe('SESSION_REVOKED');
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken })
      .expect(401);
  });

  it('always answers 204, so it reveals nothing about tokens', async () => {
    const { api } = await createTestApp();
    await api().post('/api/v1/auth/logout').send({ refreshToken: 'unknown' }).expect(204);
  });
});
