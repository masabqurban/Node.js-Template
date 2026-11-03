import { describe, expect, it } from 'vitest';

import { createTestApp } from './test/helpers.js';

describe('health probes', () => {
  it('reports liveness and readiness', async () => {
    const { api } = await createTestApp();
    const live = await api().get('/api/v1/health').expect(200);
    expect(live.body.data.status).toBe('ok');
    expect(live.headers['cache-control']).toBe('no-store');
    await api().get('/api/v1/health/ready').expect(200);
  });

  it('is not ready while a dependency is down', async () => {
    const { api } = await createTestApp({
      healthChecks: [
        { name: 'database', check: () => Promise.reject(new Error('connection refused')) },
      ],
    });
    const res = await api().get('/api/v1/health/ready').expect(503);
    expect(res.body.error).toMatchObject({ code: 'NOT_READY', details: { failed: ['database'] } });
  });
});

describe('HTTP behaviour', () => {
  it('returns JSON errors for unknown routes, bad JSON and oversized bodies', async () => {
    const { api } = await createTestApp();

    const missing = await api().get('/api/v1/nope').expect(404);
    expect(missing.body).toEqual({
      success: false,
      error: { code: 'ROUTE_NOT_FOUND', message: 'Route GET /api/v1/nope not found' },
    });

    const badJson = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":')
      .expect(400);
    expect(badJson.body.error.code).toBe('INVALID_JSON');

    const huge = await api()
      .post('/api/v1/auth/login')
      .send({ email: 'a@example.com', password: 'x'.repeat(200_000) })
      .expect(413);
    expect(huge.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('sets security headers and hides the framework', async () => {
    const { api } = await createTestApp();
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('echoes valid request ids and generates the rest', async () => {
    const { api } = await createTestApp();
    const echoed = await api().get('/api/v1/health').set('X-Request-Id', 'trace-1234567');
    expect(echoed.headers['x-request-id']).toBe('trace-1234567');

    const injected = await api().get('/api/v1/health').set('X-Request-Id', 'bad id; with <spaces>');
    expect(injected.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('allows only configured CORS origins', async () => {
    const { api } = await createTestApp({ config: { CORS_ORIGINS: 'https://app.example.com' } });
    const allowed = await api().options('/api/v1/users').set('Origin', 'https://app.example.com');
    expect(allowed.headers['access-control-allow-origin']).toBe('https://app.example.com');

    const blocked = await api().options('/api/v1/users').set('Origin', 'https://evil.example.com');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('API documentation', () => {
  it('serves an OpenAPI document generated from the routes', async () => {
    const { api } = await createTestApp({ config: { API_DOCS_ENABLED: 'true' } });
    const { body } = await api().get('/api/docs/openapi.json').expect(200);

    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toEqual(
      expect.arrayContaining([
        '/api/v1/auth/login',
        '/api/v1/users',
        '/api/v1/users/{id}',
        '/api/v1/me',
      ]),
    );
    expect(body.paths['/api/v1/users'].post.security).toEqual([{ bearerAuth: [] }]);
    expect(body.paths['/api/v1/users'].post.responses).toHaveProperty('403');
    expect(body.components.schemas).toHaveProperty('User');
  });

  it('can be switched off', async () => {
    const { api } = await createTestApp({ config: { API_DOCS_ENABLED: 'false' } });
    await api().get('/api/docs/openapi.json').expect(404);
  });
});
