import { z } from 'zod';

import { roles } from '../../shared/auth/permissions.js';
import { emailSchema, nameSchema, paginationQuery } from '../../shared/http/schemas.js';
import { userStatuses, type UserRecord } from './users.repository.js';

/** The public shape of a user. Anything not listed here never leaves the API. */
export const userDto = z
  .object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    role: z.enum(roles),
    status: z.enum(userStatuses),
    createdAt: z.iso.datetime(),
    lastActiveAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'User' });

export type UserDto = z.infer<typeof userDto>;

export function toUserDto(user: UserRecord): UserDto {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt.toISOString(),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
  };
}

export const listUsersQuery = paginationQuery.extend({
  q: z.string().trim().max(100).optional().meta({ description: 'Part of a name or email' }),
  role: z.enum(roles).optional(),
  status: z.enum(userStatuses).optional(),
});

export const createUserBody = z.object({
  name: nameSchema,
  email: emailSchema,
  role: z.enum(roles).default('viewer'),
  status: z
    .enum(userStatuses)
    .default('invited')
    .meta({ description: 'New users are usually invited and activate their account later' }),
});

// Written out rather than `createUserBody.partial()`: Zod still applies field
// defaults inside .partial(), so a PATCH of just the name would silently reset
// role and status to their creation defaults.
export const updateUserBody = z
  .object({
    name: nameSchema.optional(),
    email: emailSchema.optional(),
    role: z.enum(roles).optional(),
    status: z.enum(userStatuses).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.');

export const updateMeBody = z
  .object({ name: nameSchema, email: emailSchema })
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Send at least one field to update.');

export type ListUsersQuery = z.infer<typeof listUsersQuery>;
export type CreateUserInput = z.infer<typeof createUserBody>;
export type UpdateUserInput = z.infer<typeof updateUserBody>;
export type UpdateMeInput = z.infer<typeof updateMeBody>;
