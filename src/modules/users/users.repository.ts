import type { Role } from '../../shared/auth/permissions.js';

export const userStatuses = ['active', 'invited', 'suspended'] as const;
export type UserStatus = (typeof userStatuses)[number];

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  /** null for invited users who haven't set a password yet. */
  passwordHash: string | null;
  createdAt: Date;
  lastActiveAt: Date | null;
};

export type NewUser = Omit<UserRecord, 'createdAt' | 'lastActiveAt'> &
  Partial<Pick<UserRecord, 'createdAt' | 'lastActiveAt'>>;

export type UserFilter = {
  q?: string;
  role?: Role;
  status?: UserStatus;
  createdFrom?: Date;
  createdBefore?: Date;
};

/**
 * Persistence contract for users. Services depend on this type only, so the
 * storage engine is a swap at the composition root (`src/container.ts`):
 * write a `PrismaUserRepository`, a Mongo one, etc. that satisfies it.
 */
export type UserRepository = {
  findById(id: string): Promise<UserRecord | null>;
  /** Case-insensitive. */
  findByEmail(email: string): Promise<UserRecord | null>;
  /** Newest first. */
  list(
    filter: UserFilter,
    page: { offset: number; limit: number },
  ): Promise<{ items: UserRecord[]; total: number }>;
  count(filter: UserFilter): Promise<number>;
  create(user: NewUser): Promise<UserRecord>;
  update(
    id: string,
    patch: Partial<Omit<UserRecord, 'id' | 'createdAt'>>,
  ): Promise<UserRecord | null>;
  delete(id: string): Promise<boolean>;
};

function matches(user: UserRecord, filter: UserFilter): boolean {
  const q = filter.q?.trim().toLowerCase();
  return (
    (!q || user.name.toLowerCase().includes(q) || user.email.includes(q)) &&
    (!filter.role || user.role === filter.role) &&
    (!filter.status || user.status === filter.status) &&
    (!filter.createdFrom || user.createdAt >= filter.createdFrom) &&
    (!filter.createdBefore || user.createdAt < filter.createdBefore)
  );
}

/**
 * In-memory implementation: zero setup for development, demos and tests.
 * Data is lost on restart. Records are copied in and out so callers can never
 * mutate stored state by accident, just like with a real database.
 */
export function createInMemoryUserRepository(now: () => Date = () => new Date()): UserRepository {
  const users = new Map<string, UserRecord>();
  const copy = (user: UserRecord): UserRecord => ({ ...user });

  return {
    findById(id) {
      const user = users.get(id);
      return Promise.resolve(user ? copy(user) : null);
    },

    findByEmail(email) {
      const target = email.toLowerCase();
      const user = [...users.values()].find((u) => u.email === target);
      return Promise.resolve(user ? copy(user) : null);
    },

    list(filter, { offset, limit }) {
      const all = [...users.values()]
        .filter((user) => matches(user, filter))
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve({
        items: all.slice(offset, offset + limit).map(copy),
        total: all.length,
      });
    },

    count(filter) {
      return Promise.resolve([...users.values()].filter((user) => matches(user, filter)).length);
    },

    create(input) {
      const user: UserRecord = {
        ...input,
        email: input.email.toLowerCase(),
        createdAt: input.createdAt ?? now(),
        lastActiveAt: input.lastActiveAt ?? null,
      };
      users.set(user.id, user);
      return Promise.resolve(copy(user));
    },

    update(id, patch) {
      const existing = users.get(id);
      if (!existing) return Promise.resolve(null);
      const updated = {
        ...existing,
        ...patch,
        ...(patch.email ? { email: patch.email.toLowerCase() } : {}),
      };
      users.set(id, updated);
      return Promise.resolve(copy(updated));
    },

    delete(id) {
      return Promise.resolve(users.delete(id));
    },
  };
}
