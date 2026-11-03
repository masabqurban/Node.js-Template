import { z } from 'zod';

import { defineRoutes, type Guards } from '../../shared/http/define-routes.js';
import type { DashboardService } from './dashboard.service.js';

const summaryDto = z
  .object({
    stats: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        value: z.number(),
        change: z
          .number()
          .meta({ description: 'Versus the previous 30 days, as a ratio (0.12 = +12%)' }),
        unit: z.enum(['count', 'currency', 'percent']),
      }),
    ),
    suspended: z.number().int(),
    signups: z.array(z.object({ month: z.string(), count: z.number().int() })),
  })
  .meta({ id: 'DashboardSummary' });

/** `/dashboard`: aggregates for the admin dashboard. */
export function dashboardRoutes(service: DashboardService, guards: Guards) {
  const { route, module } = defineRoutes({ basePath: '/dashboard', tag: 'Dashboard', guards });

  route({
    method: 'get',
    path: '/summary',
    summary: 'Dashboard summary',
    description: 'Headline user numbers and new sign-ups per month for the last six months.',
    auth: 'dashboard:read',
    response: summaryDto,
    async handler() {
      return { data: await service.summary() };
    },
  });

  return module;
}
