import type { RequestHandler } from 'express';

import { defineRoutes, type Guards } from '../../shared/http/define-routes.js';
import { toUserDto } from '../users/users.schemas.js';
import { loginBody, refreshBody, registerBody, sessionDto, tokensDto } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

type SessionResult = Awaited<ReturnType<AuthService['login']>>;

const toSessionDto = ({ user, ...tokens }: SessionResult) => ({ ...tokens, user: toUserDto(user) });

/** `/auth`: sign-up, sign-in, token refresh and sign-out. */
export function authRoutes(service: AuthService, guards: Guards, authRateLimit: RequestHandler) {
  const { route, module } = defineRoutes({ basePath: '/auth', tag: 'Auth', guards });

  route({
    method: 'post',
    path: '/register',
    summary: 'Create an account',
    description: 'New accounts get the `viewer` role and are signed in straight away.',
    middleware: [authRateLimit],
    request: { body: registerBody },
    response: sessionDto,
    status: 201,
    errors: { 409: 'EMAIL_TAKEN' },
    async handler({ body }) {
      return { data: toSessionDto(await service.register(body)) };
    },
  });

  route({
    method: 'post',
    path: '/login',
    summary: 'Sign in',
    description:
      'Returns a short-lived access token (send it as `Authorization: Bearer …`) and a refresh ' +
      'token. Attempts are rate-limited per IP.',
    middleware: [authRateLimit],
    request: { body: loginBody },
    response: sessionDto,
    errors: { 401: 'INVALID_CREDENTIALS', 403: 'ACCOUNT_INACTIVE' },
    async handler({ body }) {
      return { data: toSessionDto(await service.login(body)) };
    },
  });

  route({
    method: 'post',
    path: '/refresh',
    summary: 'Get new tokens',
    description:
      'Exchanges a refresh token for a new access token and a new refresh token. Each refresh ' +
      'token works once: reusing one ends the whole session (theft detection).',
    request: { body: refreshBody },
    response: tokensDto,
    errors: { 401: 'TOKEN_INVALID, TOKEN_REUSED, TOKEN_EXPIRED or SESSION_REVOKED' },
    async handler({ body }) {
      const { accessToken, accessTokenExpiresAt, refreshToken } = await service.refresh(
        body.refreshToken,
      );
      return { data: { accessToken, accessTokenExpiresAt, refreshToken } };
    },
  });

  route({
    method: 'post',
    path: '/logout',
    summary: 'Sign out',
    description: 'Ends the session the refresh token belongs to. Always returns 204.',
    request: { body: refreshBody },
    response: null,
    async handler({ body }) {
      await service.logout(body.refreshToken);
      return undefined;
    },
  });

  return module;
}
