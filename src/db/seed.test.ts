import { describe, expect, it } from 'vitest';

import { createTestApp } from '../test/helpers.js';
import { DEMO_ACCOUNT, seedDemoData } from './seed.js';

describe('seedDemoData', () => {
  it('creates a working demo account once, however often it runs', async () => {
    const { api, container } = await createTestApp();
    await seedDemoData(container);
    await seedDemoData(container);

    // 2 users from createTestApp + 48 seeded.
    expect(await container.repositories.users.count({})).toBe(50);

    const res = await api().post('/api/v1/auth/login').send(DEMO_ACCOUNT).expect(200);
    expect(res.body.data.user).toMatchObject({ name: 'Demo Admin', role: 'admin' });
  });
});
