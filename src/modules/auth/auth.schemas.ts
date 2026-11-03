import { z } from 'zod';

import { emailSchema, nameSchema, passwordSchema } from '../../shared/http/schemas.js';
import { userDto } from '../users/users.schemas.js';

export const registerBody = z.object({
  name: nameSchema,
  email: emailSchema,
  password: passwordSchema,
});

export const loginBody = z.object({
  email: emailSchema,
  // No length rules on login: they would reveal the password policy to attackers
  // and reject passwords created under an older policy.
  password: z.string().min(1).max(1024),
});

export const refreshBody = z.object({ refreshToken: z.string().min(1).max(512) });

export const tokensDto = z
  .object({
    accessToken: z.string(),
    refreshToken: z.string(),
    accessTokenExpiresAt: z.iso.datetime(),
  })
  .meta({ id: 'Tokens' });

export const sessionDto = tokensDto.extend({ user: userDto }).meta({ id: 'Session' });

export type RegisterInput = z.infer<typeof registerBody>;
export type LoginInput = z.infer<typeof loginBody>;
