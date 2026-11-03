import { randomUUID } from 'node:crypto';

import type { Logger } from 'pino';

import { randomToken, sha256, type PasswordHasher } from '../../lib/crypto.js';
import type { AccessTokens } from '../../lib/jwt.js';
import { AppError } from '../../shared/errors/app-error.js';
import type { TokenVerifier } from '../../shared/middleware/authenticate.js';
import type { UserRecord, UserRepository } from '../users/users.repository.js';
import type { LoginInput, RegisterInput } from './auth.schemas.js';
import type { SessionRepository } from './session.repository.js';

type Dependencies = {
  users: UserRepository;
  sessions: SessionRepository;
  hasher: PasswordHasher;
  tokens: AccessTokens;
  refreshTokenTtlDays: number;
  logger: Logger;
  now?: () => Date;
};

const invalidCredentials = () =>
  AppError.unauthorized('Incorrect email or password.', 'INVALID_CREDENTIALS');

/**
 * Sign-up, sign-in and the session lifecycle.
 *
 * - Access tokens are short-lived JWTs; refresh tokens are opaque random
 *   strings stored only as hashes.
 * - Every refresh rotates the refresh token. Presenting an already-used token
 *   means it was stolen (or replayed), so the whole session family is revoked.
 */
export function createAuthService({
  users,
  sessions,
  hasher,
  tokens,
  refreshTokenTtlDays,
  logger,
  now = () => new Date(),
}: Dependencies) {
  // Verifying against a dummy hash for unknown emails keeps response times
  // equal, so timing can't reveal which emails have accounts. Computed up
  // front so even the first such request isn't slower.
  const dummyHash = hasher.hash(randomToken());
  const getDummyHash = () => dummyHash;

  async function issueSession(user: UserRecord, familyId: string = randomUUID()) {
    const issuedAt = now();
    const refreshToken = randomToken();
    await sessions.create({
      id: randomUUID(),
      familyId,
      userId: user.id,
      tokenHash: sha256(refreshToken),
      expiresAt: new Date(issuedAt.getTime() + refreshTokenTtlDays * 86_400_000),
      revokedAt: null,
      createdAt: issuedAt,
    });
    const access = await tokens.sign({ sub: user.id, sid: familyId, role: user.role }, issuedAt);
    const updated = (await users.update(user.id, { lastActiveAt: issuedAt })) ?? user;
    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      refreshToken,
      user: updated,
    };
  }

  return {
    async register(input: RegisterInput) {
      if (await users.findByEmail(input.email)) {
        throw AppError.conflict('Another account already uses this email.', 'EMAIL_TAKEN', {
          field: 'email',
        });
      }
      const user = await users.create({
        id: randomUUID(),
        name: input.name,
        email: input.email,
        // Self-registered accounts get the least privilege.
        role: 'viewer',
        status: 'active',
        passwordHash: await hasher.hash(input.password),
      });
      return issueSession(user);
    },

    async login({ email, password }: LoginInput) {
      const user = await users.findByEmail(email);
      if (!user?.passwordHash) {
        await hasher.verify(password, await getDummyHash());
        throw invalidCredentials();
      }
      if (!(await hasher.verify(password, user.passwordHash))) throw invalidCredentials();
      if (user.status !== 'active') {
        throw AppError.forbidden('This account is not active.', 'ACCOUNT_INACTIVE');
      }
      return issueSession(user);
    },

    async refresh(refreshToken: string) {
      const session = await sessions.findByTokenHash(sha256(refreshToken));
      if (!session) throw AppError.unauthorized('Invalid refresh token.', 'TOKEN_INVALID');

      const time = now();
      // `revoke` is atomic: if it was already used, this is a replay.
      if (session.revokedAt || !(await sessions.revoke(session.id, time))) {
        await sessions.revokeFamily(session.familyId, time);
        logger.warn(
          { userId: session.userId },
          'Refresh token reuse detected; session family revoked',
        );
        throw AppError.unauthorized(
          'This session has ended. Please sign in again.',
          'TOKEN_REUSED',
        );
      }
      if (session.expiresAt <= time) {
        throw AppError.unauthorized(
          'This session has expired. Please sign in again.',
          'TOKEN_EXPIRED',
        );
      }

      const user = await users.findById(session.userId);
      if (user?.status !== 'active') {
        await sessions.revokeFamily(session.familyId, time);
        throw AppError.unauthorized(
          'This session has ended. Please sign in again.',
          'SESSION_REVOKED',
        );
      }
      return issueSession(user, session.familyId);
    },

    /** Ends the session. Always succeeds, so it can't be used to probe tokens. */
    async logout(refreshToken: string) {
      const session = await sessions.findByTokenHash(sha256(refreshToken));
      if (session) await sessions.revokeFamily(session.familyId, now());
    },

    revokeUserSessions(userId: string) {
      return sessions.revokeAllForUser(userId, now());
    },

    /**
     * Verifies an access token and re-checks the session and user, so sign-out,
     * suspension and role changes apply on the next request, not at token expiry.
     */
    verifyAccessToken: (async (token) => {
      const claims = await tokens.verify(token, now());
      if (!claims) throw AppError.unauthorized('Invalid or expired access token.', 'TOKEN_INVALID');
      if (!(await sessions.isFamilyActive(claims.sid, now()))) {
        throw AppError.unauthorized('This session has ended.', 'SESSION_REVOKED');
      }
      const user = await users.findById(claims.sub);
      if (!user) throw AppError.unauthorized('This session has ended.', 'SESSION_REVOKED');
      if (user.status !== 'active') {
        throw AppError.forbidden('This account is not active.', 'ACCOUNT_INACTIVE');
      }
      // The role comes from storage, not the token, so demotions apply at once.
      return { userId: user.id, role: user.role, sessionFamilyId: claims.sid };
    }) satisfies TokenVerifier,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
