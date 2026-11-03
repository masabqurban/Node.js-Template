import { describe, expect, it } from 'vitest';

import { createMemoryRateLimitStore } from './rate-limit.js';

describe('memory rate limit store', () => {
  it('counts within a window and resets after it', async () => {
    let time = 1_000;
    const store = createMemoryRateLimitStore(() => time);

    expect(await store.hit('ip', 500)).toEqual({ count: 1, resetAt: 1_500 });
    expect((await store.hit('ip', 500)).count).toBe(2);
    expect((await store.hit('other', 500)).count).toBe(1);

    time = 1_500;
    expect(await store.hit('ip', 500)).toEqual({ count: 1, resetAt: 2_000 });
  });
});
