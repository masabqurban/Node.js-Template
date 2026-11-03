import type { Role } from '../shared/auth/permissions.js';

export type AuthContext = {
  userId: string;
  role: Role;
  sessionFamilyId: string;
};

declare global {
  namespace Express {
    interface Request {
      /** Set by the `authenticate` middleware. */
      auth?: AuthContext;
    }
  }
}
