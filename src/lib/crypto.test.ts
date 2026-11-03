import { describe, expect, it } from 'vitest';

import { createPasswordHasher, randomToken, sha256 } from './crypto.js';

describe('password hashing', () => {
  const hasher = createPasswordHasher(10);

  it('verifies the right password only', async () => {
    const hash = await hasher.hash('correct horse');
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$/);
    await expect(hasher.verify('correct horse', hash)).resolves.toBe(true);
    await expect(hasher.verify('wrong horse', hash)).resolves.toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hasher.hash('same')).not.toBe(await hasher.hash('same'));
  });

  it('keeps verifying hashes made with a different cost', async () => {
    const old = await createPasswordHasher(11).hash('legacy');
    await expect(hasher.verify('legacy', old)).resolves.toBe(true);
  });

  it('rejects malformed hashes instead of throwing', async () => {
    await expect(hasher.verify('x', 'not-a-hash')).resolves.toBe(false);
  });
});

describe('tokens', () => {
  it('creates unique URL-safe tokens and stable digests', () => {
    expect(randomToken()).toMatch(/^[\w-]{43}$/);
    expect(randomToken()).not.toBe(randomToken());
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
