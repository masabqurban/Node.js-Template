import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

type ScryptParams = { N: number; r: number; p: number; maxmem: number };

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptParams,
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;

/**
 * Password hashing with scrypt, built into Node: no native add-on to compile.
 * The output is `scrypt$N$r$p$salt$hash`, so each hash records its own
 * parameters and the cost can be raised later without breaking old hashes.
 */
export function createPasswordHasher(costLog2: number) {
  const params: ScryptParams = { N: 2 ** costLog2, r: 8, p: 1, maxmem: MAX_MEMORY };

  async function hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, KEY_LENGTH, params);
    return [
      'scrypt',
      params.N,
      params.r,
      params.p,
      salt.toString('base64'),
      derived.toString('base64'),
    ].join('$');
  }

  async function verify(password: string, stored: string): Promise<boolean> {
    const [scheme, n, r, p, salt, expected] = stored.split('$');
    if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) return false;
    const expectedBytes = Buffer.from(expected, 'base64');
    const actual = await scryptAsync(password, Buffer.from(salt, 'base64'), expectedBytes.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    });
    return timingSafeEqual(actual, expectedBytes);
  }

  return { hash, verify };
}

export type PasswordHasher = ReturnType<typeof createPasswordHasher>;

/** URL-safe random token with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Refresh tokens are stored as SHA-256 hashes, so a database leak can't be replayed. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
