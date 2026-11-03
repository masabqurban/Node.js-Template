import type { RequestHandler } from 'express';

import type { AuthContext } from '../../types/express.js';
import { can, type Permission } from '../auth/permissions.js';
import { AppError } from '../errors/app-error.js';

/** Resolves a bearer token to the signed-in user, or throws an AppError. */
export type TokenVerifier = (token: string) => Promise<AuthContext>;

export function createAuthenticate(verify: TokenVerifier): RequestHandler {
  return async (req, _res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    if (!token) throw AppError.unauthorized('Missing access token');
    req.auth = await verify(token);
    next();
  };
}

/** Must run after `authenticate`. */
export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) throw AppError.unauthorized();
    if (!can(req.auth.role, permission)) throw AppError.forbidden();
    next();
  };
}
