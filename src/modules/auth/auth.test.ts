import { describe, expect, it } from 'vitest';

import { createAccessTokens } from '../../lib/jwt.js';
import { addUser, createTestApp, PASSWORD, testConfig } from '../../test/helpers.js';

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
