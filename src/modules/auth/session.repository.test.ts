import { describe, expect, it } from 'vitest';

import { createInMemorySessionRepository, type SessionRecord } from './session.repository.js';

function makeSession(overrides: Partial<SessionRecord> & { id: string }): SessionRecord {
  const createdAt = overrides.createdAt ?? new Date('2026-01-01T00:00:00Z');
  return {
    familyId: 'family-1',
    userId: 'user-1',
    tokenHash: `hash-${overrides.id}`,
    expiresAt: new Date(createdAt.getTime() + 60_000),
    revokedAt: null,
    createdAt,
    ...overrides,
  };
}

describe('createInMemorySessionRepository', () => {
  it('maintains O(1) index consistency across create, revoke, revokeFamily, revokeAllForUser and isFamilyActive', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const repo = createInMemorySessionRepository(() => time);

    const s1 = makeSession({ id: 's1', familyId: 'f1', userId: 'u1' });
    const s2 = makeSession({ id: 's2', familyId: 'f1', userId: 'u1' });
    const s3 = makeSession({ id: 's3', familyId: 'f2', userId: 'u1' });
    const s4 = makeSession({ id: 's4', familyId: 'f3', userId: 'u2' });

    expect(await repo.create(s1)).toBe(true);
    expect(await repo.create(s2)).toBe(true);
    expect(await repo.create(s3)).toBe(true);
    expect(await repo.create(s4)).toBe(true);

    expect(repo.stats()).toEqual({
      sessions: 4,
      tokenHashes: 4,
      families: 3,
      users: 2,
      revokedFamilies: 0,
    });

    expect(await repo.findByTokenHash('hash-s1')).toMatchObject({ id: 's1', revokedAt: null });
    expect(await repo.findByTokenHash('missing')).toBeNull();
    expect(await repo.isFamilyActive('f1', time)).toBe(true);
    expect(await repo.isFamilyActive('f2', time)).toBe(true);
    expect(await repo.isFamilyActive('f3', time)).toBe(true);

    // Revoking a single token keeps the family active while s2 is unrevoked.
    expect(await repo.revoke('s1', time)).toBe(true);
    expect(await repo.revoke('s1', time)).toBe(false);
    expect(await repo.isFamilyActive('f1', time)).toBe(true);
    expect(await repo.isFamilyRevoked('f1', time)).toBe(false);

    // Revoking family f1 ends all tokens in f1 and leaves f2/f3 intact.
    await repo.revokeFamily('f1', time);
    expect(await repo.isFamilyActive('f1', time)).toBe(false);
    expect(await repo.isFamilyRevoked('f1', time)).toBe(true);
    expect((await repo.findByTokenHash('hash-s2'))?.revokedAt).toEqual(time);
    expect(await repo.isFamilyActive('f2', time)).toBe(true);
    expect(await repo.isFamilyActive('f3', time)).toBe(true);

    // Revoking all for u1 revokes f2 too, leaving u2/f3 active.
    await repo.revokeAllForUser('u1', time);
    expect(await repo.isFamilyActive('f2', time)).toBe(false);
    expect(await repo.isFamilyRevoked('f2', time)).toBe(true);
    expect((await repo.findByTokenHash('hash-s3'))?.revokedAt).toEqual(time);
    expect(await repo.isFamilyActive('f3', time)).toBe(true);
    expect(await repo.isFamilyRevoked('f3', time)).toBe(false);

    time = new Date(time.getTime() + 120_000);
    expect(await repo.isFamilyActive('f3', time)).toBe(false);
  });

  it('refuses to create active sessions in a revoked family', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const repo = createInMemorySessionRepository({
      now: () => time,
      revokedFamilyTtlMs: 30_000,
    });

    const s1 = makeSession({ id: 's1', familyId: 'f1', userId: 'u1' });
    expect(await repo.create(s1)).toBe(true);
    await repo.revokeFamily('f1', time);

    const raceSession = makeSession({ id: 's2', familyId: 'f1', userId: 'u1' });
    expect(await repo.create(raceSession)).toBe(false);
    expect(await repo.findByTokenHash('hash-s2')).toBeNull();
    expect(await repo.isFamilyActive('f1', time)).toBe(false);

    // Also blocks families revoked via revokeAllForUser.
    const s3 = makeSession({ id: 's3', familyId: 'f2', userId: 'u2' });
    expect(await repo.create(s3)).toBe(true);
    await repo.revokeAllForUser('u2', time);
    expect(await repo.create(makeSession({ id: 's4', familyId: 'f2', userId: 'u2' }))).toBe(false);
    expect(await repo.isFamilyActive('f2', time)).toBe(false);

    // Even if a family had no stored sessions when revoked, creation is blocked until tombstone TTL.
    await repo.revokeFamily('f-empty', time);
    expect(await repo.isFamilyRevoked('f-empty', time)).toBe(true);
    expect(await repo.create(makeSession({ id: 's5', familyId: 'f-empty', userId: 'u3' }))).toBe(
      false,
    );

    time = new Date(time.getTime() + 30_000);
    expect(await repo.isFamilyRevoked('f-empty', time)).toBe(false);
  });

  it('prunes expired sessions and tombstones while preserving reuse detection for unexpired rotated tokens', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const repo = createInMemorySessionRepository(() => time);

    const rotatedOld = makeSession({
      id: 's1',
      familyId: 'f1',
      userId: 'u1',
      expiresAt: new Date(time.getTime() + 60_000),
    });
    const rotatedCurrent = makeSession({
      id: 's2',
      familyId: 'f1',
      userId: 'u1',
      expiresAt: new Date(time.getTime() + 120_000),
    });

    await repo.create(rotatedOld);
    await repo.revoke('s1', time);
    await repo.create(rotatedCurrent);

    // Advance past s1 expiry, before s2 expiry: creating another session prunes s1 only.
    time = new Date(time.getTime() + 70_000);
    await repo.create(
      makeSession({
        id: 'other',
        familyId: 'f-other',
        userId: 'u2',
        expiresAt: new Date(time.getTime() + 60_000),
      }),
    );

    expect(await repo.findByTokenHash('hash-s1')).toBeNull();
    expect(await repo.findByTokenHash('hash-s2')).not.toBeNull();
    expect(await repo.isFamilyActive('f1', time)).toBe(true);

    // Revoke f1 while s2 is still unexpired; reuse detection keeps s2 until s2 expires.
    await repo.revokeFamily('f1', time);
    expect(await repo.findByTokenHash('hash-s2')).toMatchObject({ id: 's2', revokedAt: time });
    expect(await repo.isFamilyRevoked('f1', time)).toBe(true);

    // Advance past all expiries: next write prunes every expired session and tombstone.
    time = new Date(time.getTime() + 100_000);
    expect(repo.prune(time)).toBeGreaterThan(0);
    expect(repo.stats()).toEqual({
      sessions: 0,
      tokenHashes: 0,
      families: 0,
      users: 0,
      revokedFamilies: 0,
    });
  });

  it('bounds revokedFamilies memory and handles large session volumes without leaks', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const repo = createInMemorySessionRepository({
      now: () => time,
      maxRevokedFamilies: 5,
      revokedFamilyTtlMs: 60_000,
    });

    for (let i = 0; i < 10; i++) {
      await repo.revokeFamily(`fam-${i}`, time);
    }
    expect(repo.stats().revokedFamilies).toBe(5);

    // Create 2,000 sessions, rotating/expiring the first 1,990 as time advances.
    for (let i = 0; i < 2000; i++) {
      time = new Date(time.getTime() + 100);
      await repo.create(
        makeSession({
          id: `bulk-${i}`,
          familyId: `bulk-fam-${i}`,
          userId: `user-${i % 50}`,
          createdAt: time,
          expiresAt: new Date(time.getTime() + 1_000),
        }),
      );
    }

    const stats = repo.stats();
    expect(stats.sessions).toBeLessThanOrEqual(15);
    expect(stats.tokenHashes).toBe(stats.sessions);
  });
});
