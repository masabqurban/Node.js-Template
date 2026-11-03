import { describe, expect, it } from 'vitest';

import { addUser, createTestApp } from '../../test/helpers.js';

describe('GET /users', () => {
  it('paginates newest first and filters', async () => {
    const { api, login, container } = await createTestApp();
    for (let i = 0; i < 12; i++) {
      await addUser(container, {
        name: `Person ${i}`,
        role: i % 3 === 0 ? 'editor' : 'viewer',
        createdAt: new Date(Date.UTC(2026, 0, i + 1)),
      });
    }
    const { auth } = await login('viewer@example.com');

    const page = await api().get('/api/v1/users?page=2&pageSize=5').set(auth).expect(200);
    expect(page.body.meta).toEqual({ page: 2, pageSize: 5, total: 14, totalPages: 3 });
    expect(page.body.data).toHaveLength(5);

    const editors = await api().get('/api/v1/users?role=editor').set(auth).expect(200);
    expect(editors.body.data.every((u: { role: string }) => u.role === 'editor')).toBe(true);
    expect(editors.body.meta.total).toBe(4);

    const search = await api().get('/api/v1/users?q=ADA').set(auth).expect(200);
    expect(search.body.data.map((u: { name: string }) => u.name)).toEqual(['Ada Admin']);
  });

  it('rejects invalid query parameters', async () => {
    const { api, login } = await createTestApp();
    const { auth } = await login('viewer@example.com');
    const res = await api().get('/api/v1/users?pageSize=500&role=root').set(auth).expect(400);
    expect(res.body.error.details.map((d: { path: string }) => d.path).sort()).toEqual([
      'pageSize',
      'role',
    ]);
  });
});

describe('user management permissions', () => {
  it('lets viewers read but not write', async () => {
    const { api, login, admin } = await createTestApp();
    const { auth } = await login('viewer@example.com');

    await api().get(`/api/v1/users/${admin.id}`).set(auth).expect(200);
    const res = await api()
      .post('/api/v1/users')
      .set(auth)
      .send({ name: 'New Person', email: 'new@example.com' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('applies a demotion on the very next request', async () => {
    const { api, login, container } = await createTestApp();
    const other = await addUser(container, { email: 'other-admin@example.com', role: 'admin' });
    const otherSession = await login('other-admin@example.com');
    const { auth } = await login('admin@example.com');

    await api().patch(`/api/v1/users/${other.id}`).set(auth).send({ role: 'viewer' }).expect(200);

    // Their token still says "admin", but roles are re-read on every request.
    await api()
      .post('/api/v1/users')
      .set(otherSession.auth)
      .send({ name: 'X Y', email: 'x@example.com' })
      .expect(403);
  });
});

describe('POST/PATCH/DELETE /users', () => {
  it('creates invited users and rejects duplicate emails', async () => {
    const { api, login } = await createTestApp();
    const { auth } = await login('admin@example.com');

    const created = await api()
      .post('/api/v1/users')
      .set(auth)
      .send({ name: 'Grace Hopper', email: 'Grace@Example.com', role: 'editor' })
      .expect(201);
    expect(created.body.data).toMatchObject({
      email: 'grace@example.com',
      role: 'editor',
      status: 'invited',
    });

    const dup = await api()
      .post('/api/v1/users')
      .set(auth)
      .send({ name: 'Copy', email: 'grace@example.com' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'EMAIL_TAKEN', details: { field: 'email' } });
  });

  it('only changes the fields sent', async () => {
    const { api, login, container } = await createTestApp();
    const editor = await addUser(container, { role: 'editor', status: 'active' });
    const { auth } = await login('admin@example.com');

    const res = await api()
      .patch(`/api/v1/users/${editor.id}`)
      .set(auth)
      .send({ name: 'Renamed' })
      .expect(200);
    // Regression guard: schema defaults must not reset role or status on PATCH.
    expect(res.body.data).toMatchObject({ name: 'Renamed', role: 'editor', status: 'active' });
  });

  it('ends all sessions of a suspended user at once', async () => {
    const { api, login, viewer } = await createTestApp();
    const victim = await login('viewer@example.com');
    const { auth } = await login('admin@example.com');

    await api()
      .patch(`/api/v1/users/${viewer.id}`)
      .set(auth)
      .send({ status: 'suspended' })
      .expect(200);

    const me = await api().get('/api/v1/me').set(victim.auth);
    expect(me.status).toBe(401);
    await api()
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: victim.refreshToken })
      .expect(401);
  });

  it('stops admins from locking themselves out', async () => {
    const { api, login, admin } = await createTestApp();
    const { auth } = await login('admin@example.com');

    const demote = await api()
      .patch(`/api/v1/users/${admin.id}`)
      .set(auth)
      .send({ role: 'viewer' });
    expect(demote.body.error.code).toBe('CANNOT_MODIFY_SELF');
    const remove = await api().delete(`/api/v1/users/${admin.id}`).set(auth);
    expect(remove.status).toBe(422);
    expect(remove.body.error.code).toBe('CANNOT_DELETE_SELF');
  });

  it('deletes users', async () => {
    const { api, login, viewer } = await createTestApp();
    const { auth } = await login('admin@example.com');

    await api().delete(`/api/v1/users/${viewer.id}`).set(auth).expect(204);
    const gone = await api().get(`/api/v1/users/${viewer.id}`).set(auth).expect(404);
    expect(gone.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects an empty update', async () => {
    const { api, login, viewer } = await createTestApp();
    const { auth } = await login('admin@example.com');
    await api().patch(`/api/v1/users/${viewer.id}`).set(auth).send({}).expect(400);
  });
});

describe('/me', () => {
  it('returns and updates the signed-in user', async () => {
    const { api, login } = await createTestApp();
    const { auth } = await login('viewer@example.com');

    const me = await api().get('/api/v1/me').set(auth).expect(200);
    expect(me.body.data.email).toBe('viewer@example.com');

    const updated = await api()
      .patch('/api/v1/me')
      .set(auth)
      .send({ name: 'Victoria' })
      .expect(200);
    expect(updated.body.data).toMatchObject({ name: 'Victoria', role: 'viewer' });

    const taken = await api().patch('/api/v1/me').set(auth).send({ email: 'admin@example.com' });
    expect(taken.body.error.code).toBe('EMAIL_TAKEN');
  });
});
