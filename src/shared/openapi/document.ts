import { createDocument, type ZodOpenApiPathsObject } from 'zod-openapi';

import type { RouteModule } from '../http/define-routes.js';

/** Built from the registered routes, so the documentation always matches the code. */
export function buildOpenApiDocument(modules: RouteModule[]) {
  return createDocument({
    openapi: '3.1.0',
    info: {
      title: 'Node.js Template API',
      version: '1.0.0',
      description:
        'Every response uses one envelope: `{ "success": true, "data": …, "meta"?: … }` or ' +
        '`{ "success": false, "error": { "code", "message", "details"? } }`. Branch on `error.code`, ' +
        'never on the message.\n\n' +
        'Sign in with `POST /api/v1/auth/login`, then send `Authorization: Bearer <accessToken>`. ' +
        'Demo account (development only): `demo@example.com` / `password123`.',
    },
    servers: [{ url: '/' }],
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } },
    },
    paths: modules.reduce<ZodOpenApiPathsObject>((all, m) => ({ ...all, ...m.paths }), {}),
  });
}
