import { describe, expect, it } from 'vitest';

import { parseConfig } from './env.js';

const SECRET = 'x'.repeat(32);

describe('parseConfig', () => {
  it('applies defaults and treats empty values as unset', () => {
    const config = parseConfig({
      JWT_ACCESS_SECRET: SECRET,
      PORT: '',
      CORS_ORIGINS: ' https://a.com , https://b.com,',
    });
    expect(config.PORT).toBe(4000);
    expect(config.CORS_ORIGINS).toEqual(['https://a.com', 'https://b.com']);
    expect(config.seedDemoData).toBe(true);
    expect(config.apiDocsEnabled).toBe(true);
  });

  it('uses safe defaults in production', () => {
    const config = parseConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'production' });
    expect(config.seedDemoData).toBe(false);
    expect(config.apiDocsEnabled).toBe(false);
  });

  it('rejects weak secrets and demo data in production', () => {
    expect(() => parseConfig({ JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() =>
      parseConfig({ JWT_ACCESS_SECRET: SECRET, NODE_ENV: 'production', SEED_DEMO_DATA: 'true' }),
    ).toThrow(/production/);
  });
});
