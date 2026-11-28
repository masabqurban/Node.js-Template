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
  /**
   * Stores a new session. Returns false without creating an active session if
   * its family has already been revoked (prevents refresh/revocation races).
   */
  create(session: SessionRecord): Promise<boolean>;
  findByTokenHash(tokenHash: string): Promise<SessionRecord | null>;
  /**
   * Atomically marks one token as used. Returns false if it was already
   * revoked, so two concurrent refreshes with the same token can't both win.
   */
  revoke(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
  /** True while the family has an unrevoked, unexpired token and is not revoked. */
  isFamilyActive(familyId: string, now: Date): Promise<boolean>;
  /** True while the family has an unexpired revocation tombstone. */
  isFamilyRevoked(familyId: string, now: Date): Promise<boolean>;
};

export type InMemorySessionRepositoryOptions = {
  now?: () => Date;
  /** Fallback TTL for tombstones when a family is revoked with no active sessions stored. */
  revokedFamilyTtlMs?: number;
  /** Upper bound on stored family revocation tombstones to prevent unbounded growth. */
  maxRevokedFamilies?: number;
};

export type InMemorySessionStats = {
  sessions: number;
  tokenHashes: number;
  families: number;
  users: number;
  revokedFamilies: number;
};

export type InMemorySessionRepository = SessionRepository & {
  prune(at?: Date): number;
  stats(): InMemorySessionStats;
};

type ExpiryEntry = {
  key: string;
  expiresAtMs: number;
};

const DEFAULT_REVOKED_FAMILY_TTL_MS = 30 * 86_400_000;
const DEFAULT_MAX_REVOKED_FAMILIES = 100_000;

function createMinExpiryHeap() {
  const items: ExpiryEntry[] = [];

  function siftUp(index: number) {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const current = items[i];
      const parentItem = items[parent];
      if (!current || !parentItem || current.expiresAtMs >= parentItem.expiresAtMs) break;
      items[i] = parentItem;
      items[parent] = current;
      i = parent;
    }
  }

  function siftDown(index: number) {
    let i = index;
    const length = items.length;
    while (i < length) {
      const left = i * 2 + 1;
      const right = left + 1;
      let smallest = i;
      let smallestItem = items[i];
      if (!smallestItem) break;

      const leftItem = items[left];
      if (left < length && leftItem && leftItem.expiresAtMs < smallestItem.expiresAtMs) {
        smallest = left;
        smallestItem = leftItem;
      }

      const rightItem = items[right];
      if (right < length && rightItem && rightItem.expiresAtMs < smallestItem.expiresAtMs) {
        smallest = right;
        smallestItem = rightItem;
      }

      if (smallest === i) break;
      const current = items[i];
      if (!current) break;
      items[i] = smallestItem;
      items[smallest] = current;
      i = smallest;
    }
  }

  return {
    size: () => items.length,
    peek: () => items[0],
    push(entry: ExpiryEntry) {
      items.push(entry);
      siftUp(items.length - 1);
    },
    pop(): ExpiryEntry | undefined {
      const first = items[0];
      if (!first) return undefined;
      const last = items.pop();
      if (items.length > 0 && last) {
        items[0] = last;
        siftDown(0);
      }
      return first;
    },
    rebuild(entries: Iterable<ExpiryEntry>) {
      items.length = 0;
      for (const entry of entries) items.push(entry);
      for (let i = Math.floor(items.length / 2) - 1; i >= 0; i--) {
        siftDown(i);
      }
    },
  };
}

function copySession(session: SessionRecord): SessionRecord {
  return {
    ...session,
    expiresAt: new Date(session.expiresAt.getTime()),
    revokedAt: session.revokedAt ? new Date(session.revokedAt.getTime()) : null,
    createdAt: new Date(session.createdAt.getTime()),
  };
}

/**
 * In-memory implementation backed by secondary `Map`/`Set` indexes and min-heaps
 * for `O(1)` lookup and amortized `O(1)` expiry pruning.
 */
export function createInMemorySessionRepository(
  nowOrOptions: (() => Date) | InMemorySessionRepositoryOptions = {},
): InMemorySessionRepository {
  const options = typeof nowOrOptions === 'function' ? { now: nowOrOptions } : nowOrOptions;
  const now = options.now ?? (() => new Date());
  const revokedFamilyTtlMs = options.revokedFamilyTtlMs ?? DEFAULT_REVOKED_FAMILY_TTL_MS;
  const maxRevokedFamilies = options.maxRevokedFamilies ?? DEFAULT_MAX_REVOKED_FAMILIES;

  const sessions = new Map<string, SessionRecord>();
  const byTokenHash = new Map<string, SessionRecord>();
  const byFamilyId = new Map<string, Set<string>>();
  const byUserId = new Map<string, Set<string>>();
  const revokedFamilies = new Map<string, number>();

  const sessionExpiryHeap = createMinExpiryHeap();
  const familyExpiryHeap = createMinExpiryHeap();

  const deleteSession = (session: SessionRecord) => {
    sessions.delete(session.id);
    if (byTokenHash.get(session.tokenHash)?.id === session.id) {
      byTokenHash.delete(session.tokenHash);
    }

    const familySet = byFamilyId.get(session.familyId);
    if (familySet) {
      familySet.delete(session.id);
      if (familySet.size === 0) byFamilyId.delete(session.familyId);
    }

    const userSet = byUserId.get(session.userId);
    if (userSet) {
      userSet.delete(session.id);
      if (userSet.size === 0) byUserId.delete(session.userId);
    }
  };

  const insertSession = (session: SessionRecord) => {
    const existingById = sessions.get(session.id);
    if (existingById) deleteSession(existingById);
    const existingByHash = byTokenHash.get(session.tokenHash);
    if (existingByHash) deleteSession(existingByHash);

    const stored = copySession(session);
    sessions.set(stored.id, stored);
    byTokenHash.set(stored.tokenHash, stored);

    let familySet = byFamilyId.get(stored.familyId);
    if (!familySet) {
      familySet = new Set();
      byFamilyId.set(stored.familyId, familySet);
    }
    familySet.add(stored.id);

    let userSet = byUserId.get(stored.userId);
    if (!userSet) {
      userSet = new Set();
      byUserId.set(stored.userId, userSet);
    }
    userSet.add(stored.id);

    sessionExpiryHeap.push({ key: stored.id, expiresAtMs: stored.expiresAt.getTime() });
    if (sessionExpiryHeap.size() > Math.max(1024, sessions.size * 2)) {
      sessionExpiryHeap.rebuild(
        Array.from(sessions.values(), (s) => ({ key: s.id, expiresAtMs: s.expiresAt.getTime() })),
      );
    }
  };

  const recordFamilyRevoked = (familyId: string, expiresAtMs: number) => {
    if (maxRevokedFamilies <= 0) return;
    const existing = revokedFamilies.get(familyId);
    if (existing !== undefined && existing >= expiresAtMs) return;

    // Re-insert so Map iteration order tracks recency for bounded eviction.
    revokedFamilies.delete(familyId);
    revokedFamilies.set(familyId, expiresAtMs);
    familyExpiryHeap.push({ key: familyId, expiresAtMs });

    while (revokedFamilies.size > maxRevokedFamilies) {
      const oldest = revokedFamilies.keys().next().value;
      if (oldest === undefined) break;
      revokedFamilies.delete(oldest);
    }

    if (familyExpiryHeap.size() > Math.max(1024, revokedFamilies.size * 2)) {
      familyExpiryHeap.rebuild(
        Array.from(revokedFamilies.entries(), ([key, exp]) => ({ key, expiresAtMs: exp })),
      );
    }
  };

  const pruneAt = (nowMs: number): number => {
    let removed = 0;

    let topSession = sessionExpiryHeap.peek();
    while (topSession && topSession.expiresAtMs <= nowMs) {
      sessionExpiryHeap.pop();
      const session = sessions.get(topSession.key);
      if (session?.expiresAt.getTime() === topSession.expiresAtMs) {
        deleteSession(session);
        removed++;
      }
      topSession = sessionExpiryHeap.peek();
    }

    let topFamily = familyExpiryHeap.peek();
    while (topFamily && topFamily.expiresAtMs <= nowMs) {
      familyExpiryHeap.pop();
      const currentExpiry = revokedFamilies.get(topFamily.key);
      if (currentExpiry !== undefined && currentExpiry === topFamily.expiresAtMs) {
        revokedFamilies.delete(topFamily.key);
        removed++;
      }
      topFamily = familyExpiryHeap.peek();
    }

    return removed;
  };

  const revokeFamilySync = (familyId: string, at: Date) => {
    const familyIds = byFamilyId.get(familyId);
    let maxExpiresAt = 0;

    if (familyIds) {
      for (const id of familyIds) {
        const session = sessions.get(id);
        if (!session) continue;
        session.revokedAt ??= new Date(at.getTime());
        maxExpiresAt = Math.max(maxExpiresAt, session.expiresAt.getTime());
      }
    }

    const tombstoneExpiresAt = maxExpiresAt > 0 ? maxExpiresAt : at.getTime() + revokedFamilyTtlMs;
    recordFamilyRevoked(familyId, tombstoneExpiresAt);
  };

  const hasActiveTombstone = (familyId: string, atMs: number) => {
    const tombstone = revokedFamilies.get(familyId);
    return tombstone !== undefined && tombstone > atMs;
  };

  return {
    create(session) {
      const nowMs = now().getTime();
      pruneAt(nowMs);
      if (hasActiveTombstone(session.familyId, nowMs)) {
        return Promise.resolve(false);
      }
      insertSession(session);
      return Promise.resolve(true);
    },

    findByTokenHash(tokenHash) {
      // Do not prune before lookup so expired unrevoked tokens remain inspectable
      // for `TOKEN_EXPIRED` responses until the next write-side prune cycle.
      const session = byTokenHash.get(tokenHash);
      return Promise.resolve(session ? copySession(session) : null);
    },

    revoke(id, at) {
      const session = sessions.get(id);
      if (!session || session.revokedAt) {
        pruneAt(now().getTime());
        return Promise.resolve(false);
      }
      session.revokedAt = new Date(at.getTime());
      pruneAt(now().getTime());
      return Promise.resolve(true);
    },

    revokeFamily(familyId, at) {
      revokeFamilySync(familyId, at);
      pruneAt(now().getTime());
      return Promise.resolve();
    },

    revokeAllForUser(userId, at) {
      const userSessionIds = byUserId.get(userId);
      if (userSessionIds) {
        const familyIds = new Set<string>();
        for (const id of userSessionIds) {
          const session = sessions.get(id);
          if (session) familyIds.add(session.familyId);
        }
        for (const familyId of familyIds) {
          revokeFamilySync(familyId, at);
        }
      }
      pruneAt(now().getTime());
      return Promise.resolve();
    },

    isFamilyActive(familyId, current) {
      const currentMs = current.getTime();
      if (hasActiveTombstone(familyId, currentMs)) return Promise.resolve(false);
      const familyIds = byFamilyId.get(familyId);
      if (!familyIds) return Promise.resolve(false);
      for (const id of familyIds) {
        const session = sessions.get(id);
        if (session && !session.revokedAt && session.expiresAt.getTime() > currentMs) {
          return Promise.resolve(true);
        }
      }
      return Promise.resolve(false);
    },

    isFamilyRevoked(familyId, current) {
      return Promise.resolve(hasActiveTombstone(familyId, current.getTime()));
    },

    prune(at = now()) {
      return pruneAt(at.getTime());
    },

    stats() {
      return {
        sessions: sessions.size,
        tokenHashes: byTokenHash.size,
        families: byFamilyId.size,
        users: byUserId.size,
        revokedFamilies: revokedFamilies.size,
      };
    },
  };
}
