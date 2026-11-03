import { randomUUID } from 'node:crypto';

import { AppError } from '../../shared/errors/app-error.js';
import type { UserRecord, UserRepository } from './users.repository.js';
import type {
  CreateUserInput,
  ListUsersQuery,
  UpdateMeInput,
  UpdateUserInput,
} from './users.schemas.js';

type Dependencies = {
  users: UserRepository;
  /** Ends every session of a user, so suspension or deletion takes effect immediately. */
  revokeSessions: (userId: string) => Promise<void>;
};

const emailTaken = () =>
  AppError.conflict('Another account already uses this email.', 'EMAIL_TAKEN', { field: 'email' });

/** Business rules for user management. Knows nothing about HTTP. */
export function createUsersService({ users, revokeSessions }: Dependencies) {
  async function getOrThrow(id: string): Promise<UserRecord> {
    const user = await users.findById(id);
    if (!user) throw AppError.notFound('User not found.');
    return user;
  }

  async function assertEmailAvailable(email: string, exceptId?: string) {
    const existing = await users.findByEmail(email);
    if (existing && existing.id !== exceptId) throw emailTaken();
  }

  return {
    get: getOrThrow,

    async list({ page, pageSize, ...filter }: ListUsersQuery) {
      return users.list(filter, { offset: (page - 1) * pageSize, limit: pageSize });
    },

    async create(input: CreateUserInput) {
      await assertEmailAvailable(input.email);
      return users.create({ id: randomUUID(), ...input, passwordHash: null });
    },

    async update(actorId: string, id: string, patch: UpdateUserInput) {
      const user = await getOrThrow(id);
      if (
        id === actorId &&
        ((patch.role && patch.role !== user.role) || (patch.status && patch.status !== 'active'))
      ) {
        // Prevents admins from locking themselves (and possibly everyone) out.
        throw AppError.unprocessable(
          "You can't change your own role or status.",
          'CANNOT_MODIFY_SELF',
        );
      }
      if (patch.email) await assertEmailAvailable(patch.email, id);

      const updated = await users.update(id, patch);
      if (!updated) throw AppError.notFound('User not found.');
      if (patch.status && patch.status !== 'active') await revokeSessions(id);
      return updated;
    },

    async updateMe(userId: string, patch: UpdateMeInput) {
      if (patch.email) await assertEmailAvailable(patch.email, userId);
      const updated = await users.update(userId, patch);
      if (!updated) throw AppError.notFound('User not found.');
      return updated;
    },

    async delete(actorId: string, id: string) {
      if (id === actorId) {
        throw AppError.unprocessable("You can't delete your own account.", 'CANNOT_DELETE_SELF');
      }
      await getOrThrow(id);
      await revokeSessions(id);
      await users.delete(id);
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
