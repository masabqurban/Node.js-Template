import { SignJWT, jwtVerify } from 'jose';

import type { Role } from '../shared/auth/permissions.js';

const ISSUER = 'nodejs-template';
const AUDIENCE = 'nodejs-template-clients';

export type AccessTokenClaims = {
  /** User id. */
  sub: string;
  /** Session family. Checked on every request, so sign-out takes effect at once. */
  sid: string;
  role: Role;
};

/** Short-lived HS256 access tokens. Rename ISSUER/AUDIENCE for your project. */
export function createAccessTokens(secret: string, ttlSeconds: number) {
  const key = new TextEncoder().encode(secret);

  async function sign(claims: AccessTokenClaims, now = new Date()) {
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const token = await new SignJWT({ sid: claims.sid, role: claims.role })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(key);
    return { token, expiresAt };
  }

  /** The claims, or null for any invalid, tampered or expired token. */
  async function verify(token: string, now = new Date()): Promise<AccessTokenClaims | null> {
    try {
      const { payload } = await jwtVerify(token, key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        // Pinning the algorithm blocks `alg: none` and algorithm-confusion attacks.
        algorithms: ['HS256'],
        // Same clock as signing, so time is consistent (and injectable in tests).
        currentDate: now,
      });
      const { sub, sid, role } = payload;
      if (typeof sub !== 'string' || typeof sid !== 'string' || typeof role !== 'string') {
        return null;
      }
      return { sub, sid, role: role as Role };
    } catch {
      return null;
    }
  }

  return { sign, verify };
}

export type AccessTokens = ReturnType<typeof createAccessTokens>;
