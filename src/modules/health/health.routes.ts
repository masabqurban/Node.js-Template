import { z } from 'zod';

import { AppError } from '../../shared/errors/app-error.js';
import { defineRoutes, type Guards } from '../../shared/http/define-routes.js';

/** A dependency the readiness probe checks, e.g. the database or Redis. */
export type HealthCheck = { name: string; check: () => Promise<void> };

/**
 * `/health`: liveness (`/health`) for "restart me if this fails" and
 * readiness (`/health/ready`) for "send me traffic only when this passes".
 */
export function healthRoutes(checks: HealthCheck[], guards: Guards, startedAt = Date.now()) {
  const { route, module } = defineRoutes({ basePath: '/health', tag: 'Health', guards });

  route({
    method: 'get',
    path: '/',
    summary: 'Liveness probe',
    response: z.object({ status: z.literal('ok'), uptimeSeconds: z.number().int() }),
    handler({ res }) {
      res.setHeader('Cache-Control', 'no-store');
      return {
        data: { status: 'ok' as const, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) },
      };
    },
  });

  route({
    method: 'get',
    path: '/ready',
    summary: 'Readiness probe',
    description: 'Checks every dependency. Responds 503 when any of them is unavailable.',
    response: z.object({
      status: z.literal('ready'),
      checks: z.record(z.string(), z.literal('ok')),
    }),
    errors: { 503: 'A dependency is unavailable' },
    async handler({ res, req }) {
      res.setHeader('Cache-Control', 'no-store');
      const results = await Promise.allSettled(checks.map((c) => c.check()));
      const failed = checks.filter((_, i) => results[i]?.status === 'rejected').map((c) => c.name);
      if (failed.length) {
        req.log.warn({ failed }, 'Readiness check failed');
        throw new AppError(503, 'NOT_READY', 'Some dependencies are unavailable.', { failed });
      }
      return {
        data: {
          status: 'ready' as const,
          checks: Object.fromEntries(checks.map((c) => [c.name, 'ok' as const])),
        },
      };
    },
  });

  return module;
}
