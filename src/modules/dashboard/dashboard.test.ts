import { describe, expect, it } from 'vitest';

import { addUser, createTestApp } from '../../test/helpers.js';
import { ratioChange } from './dashboard.service.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

describe('GET /dashboard/summary', () => {
  it('computes headline numbers and monthly sign-ups', async () => {
    const { api, login, container } = await createTestApp({ now: () => NOW });
    // The admin and viewer from createTestApp are created "now" (June).
    await addUser(container, { createdAt: daysAgo(5), status: 'invited', password: null });
    await addUser(container, { createdAt: daysAgo(40) });
    await addUser(container, { createdAt: daysAgo(70), status: 'suspended' });
    const { auth } = await login('viewer@example.com');

    const { body } = await api().get('/api/v1/dashboard/summary').set(auth).expect(200);
    const stat = (key: string) => body.data.stats.find((s: { key: string }) => s.key === key);

    expect(stat('users')).toMatchObject({ value: 5, change: 1.5 });
    expect(stat('new')).toMatchObject({ value: 3, change: 2 });
    expect(stat('active').value).toBe(3);
    expect(stat('pending').value).toBe(1);
    expect(body.data.suspended).toBe(1);
    expect(body.data.signups).toEqual([
      { month: 'Jan', count: 0 },
      { month: 'Feb', count: 0 },
      { month: 'Mar', count: 0 },
      { month: 'Apr', count: 1 },
      { month: 'May', count: 1 },
      { month: 'Jun', count: 3 },
    ]);
  });

  it('requires sign-in', async () => {
    const { api } = await createTestApp();
    await api().get('/api/v1/dashboard/summary').expect(401);
  });
});

describe('ratioChange', () => {
  it('handles growth, decline and a zero baseline', () => {
    expect(ratioChange(12, 10)).toBe(0.2);
    expect(ratioChange(9, 10)).toBe(-0.1);
    expect(ratioChange(0, 0)).toBe(0);
    expect(ratioChange(5, 0)).toBe(1);
  });
});
