export type SessionRecord = {
  id: string;
  /** Every rotation of one sign-in shares a family, so they can be revoked together. */
  familyId: string;
  userId: string;
  /** SHA-256 of the refresh token. The token itself is never stored. */
  tokenHash: string;
  expiresAt: Date;
  /** Set when the token is rotated or the session ends. */
  revokedAt: Date | null;
  createdAt: Date;
};

/** Persistence contract for refresh-token sessions. See `UserRepository` for swapping storage. */
export type SessionRepository = {
  create(session: SessionRecord): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /**
   * Atomically marks one token as used. Returns false if it was already
   * revoked, so two concurrent refreshes with the same token can't both win.
   */
  revoke(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  /** True while the family has an unrevoked, unexpired token. */
  isFamilyActive(familyId: string, now: Date): Promise<boolean>;
};

export function createInMemorySessionRepository(): SessionRepository {
  const sessions = new Map<string, SessionRecord>();

  const revokeWhere = (predicate: (s: SessionRecord) => boolean, at: Date) => {
    for (const session of sessions.values()) {
      if (predicate(session) && !session.revokedAt) session.revokedAt = at;
    }
  };

  return {
    create(session) {
      sessions.set(session.id, { ...session });
      return Promise.resolve();
    },

    findByTokenHash(tokenHash) {
      const session = [...sessions.values()].find((s) => s.tokenHash === tokenHash);
      return Promise.resolve(session ? { ...session } : null);
    },

    revoke(id, at) {
      const session = sessions.get(id);
      if (!session || session.revokedAt) return Promise.resolve(false);
      session.revokedAt = at;
      return Promise.resolve(true);
    },

    revokeFamily(familyId, at) {
      revokeWhere((s) => s.familyId === familyId, at);
      return Promise.resolve();
    },

    revokeAllForUser(userId, at) {
      revokeWhere((s) => s.userId === userId, at);
      return Promise.resolve();
    },

    isFamilyActive(familyId, now) {
      return Promise.resolve(
        [...sessions.values()].some(
          (s) => s.familyId === familyId && !s.revokedAt && s.expiresAt > now,
        ),
      );
    },
  };
}
