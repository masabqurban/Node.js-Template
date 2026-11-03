import { z } from 'zod';

import { defineRoutes, type Guards } from '../../shared/http/define-routes.js';
import { idParams, pageMeta } from '../../shared/http/schemas.js';
import type { UsersService } from './users.service.js';
import {
  createUserBody,
  listUsersQuery,
  toUserDto,
  updateMeBody,
  updateUserBody,
  userDto,
} from './users.schemas.js';

/** `/users`: user management. Everyone signed in can read; only admins can write. */
export function usersRoutes(service: UsersService, guards: Guards) {
  const { route, module } = defineRoutes({ basePath: '/users', tag: 'Users', guards });

  route({
    method: 'get',
    path: '/',
    summary: 'List users',
    description: 'Newest first. Filter by search text, role and status.',
    auth: 'users:read',
    request: { query: listUsersQuery },
    response: z.array(userDto),
    async handler({ query }) {
      const { items, total } = await service.list(query);
      return { data: items.map(toUserDto), meta: pageMeta(query.page, query.pageSize, total) };
    },
  });

  route({
    method: 'get',
    path: '/:id',
    summary: 'Get a user',
    auth: 'users:read',
    request: { params: idParams },
    response: userDto,
    errors: { 404: 'User not found' },
    async handler({ params }) {
      return { data: toUserDto(await service.get(params.id)) };
    },
  });

  route({
    method: 'post',
    path: '/',
    summary: 'Create a user',
    auth: 'users:write',
    request: { body: createUserBody },
    response: userDto,
    status: 201,
    errors: { 409: 'EMAIL_TAKEN: another account already uses this email' },
    async handler({ body }) {
      return { data: toUserDto(await service.create(body)) };
    },
  });

  route({
    method: 'patch',
    path: '/:id',
    summary: 'Update a user',
    description: 'Suspending a user ends all of their sessions immediately.',
    auth: 'users:write',
    request: { params: idParams, body: updateUserBody },
    response: userDto,
    errors: {
      404: 'User not found',
      409: 'EMAIL_TAKEN',
      422: 'CANNOT_MODIFY_SELF: admins cannot change their own role or status',
    },
    async handler({ params, body, auth }) {
      return { data: toUserDto(await service.update(auth.userId, params.id, body)) };
    },
  });

  route({
    method: 'delete',
    path: '/:id',
    summary: 'Delete a user',
    auth: 'users:write',
    request: { params: idParams },
    response: null,
    errors: { 404: 'User not found', 422: 'CANNOT_DELETE_SELF' },
    async handler({ params, auth }) {
      await service.delete(auth.userId, params.id);
      return undefined;
    },
  });

  return module;
}

/** `/me`: the signed-in user's own profile. */
export function meRoutes(service: UsersService, guards: Guards) {
  const { route, module } = defineRoutes({ basePath: '/me', tag: 'Me', guards });

  route({
    method: 'get',
    path: '/',
    summary: 'Get the signed-in user',
    auth: true,
    response: userDto,
    async handler({ auth }) {
      return { data: toUserDto(await service.get(auth.userId)) };
    },
  });

  route({
    method: 'patch',
    path: '/',
    summary: 'Update your own profile',
    auth: true,
    request: { body: updateMeBody },
    response: userDto,
    errors: { 409: 'EMAIL_TAKEN' },
    async handler({ body, auth }) {
      return { data: toUserDto(await service.updateMe(auth.userId, body)) };
    },
  });

  return module;
}
