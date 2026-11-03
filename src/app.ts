import { randomUUID } from 'node:crypto';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import swaggerUi from 'swagger-ui-express';

import type { Container } from './container.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { meRoutes, usersRoutes } from './modules/users/users.routes.js';
import type { Guards } from './shared/http/define-routes.js';
import { createAuthenticate, requirePermission } from './shared/middleware/authenticate.js';
import { errorHandler, notFound } from './shared/middleware/error-handler.js';
import { buildOpenApiDocument } from './shared/openapi/document.js';
import { rateLimit } from './shared/rate-limit/rate-limit.js';

const API_PREFIX = '/api/v1';
/** Accept a caller's request id only if it looks like one, so logs can't be polluted. */
const REQUEST_ID = /^[\w-]{8,128}$/;

/** Builds the Express app from a container. No side effects: `server.ts` decides when to listen. */
export function createApp(container: Container) {
  const { config, services, rateLimitStore } = container;
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);

  app.use(
    pinoHttp({
      logger: container.logger,
      genReqId: (req, res) => {
        const incoming = req.headers['x-request-id'];
        const id =
          typeof incoming === 'string' && REQUEST_ID.test(incoming) ? incoming : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      customLogLevel: (_req, res, err) =>
        err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
      // Probes run every few seconds; logging them would drown everything else.
      autoLogging: { ignore: (req) => req.url.startsWith(`${API_PREFIX}/health`) },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(helmet());
  app.use(
    cors({
      origin: config.CORS_ORIGINS,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: [
        'X-Request-Id',
        'RateLimit-Limit',
        'RateLimit-Remaining',
        'RateLimit-Reset',
        'Retry-After',
      ],
      maxAge: 600,
    }),
  );
  // Small bodies only: this is a JSON API, not a file upload endpoint.
  app.use(express.json({ limit: '100kb' }));

  const guards: Guards = {
    authenticate: createAuthenticate(services.auth.verifyAccessToken),
    requirePermission,
  };

  const apiLimit = rateLimit({
    store: rateLimitStore,
    name: 'api',
    limit: config.RATE_LIMIT_PER_MINUTE,
    windowMs: 60_000,
  });
  const authLimit = rateLimit({
    store: rateLimitStore,
    name: 'auth',
    limit: config.AUTH_RATE_LIMIT_MAX,
    windowMs: config.AUTH_RATE_LIMIT_WINDOW_SECONDS * 1000,
  });

  const modules = [
    healthRoutes(container.healthChecks, guards),
    authRoutes(services.auth, guards, authLimit),
    meRoutes(services.users, guards),
    usersRoutes(services.users, guards),
    dashboardRoutes(services.dashboard, guards),
  ];

  for (const module of modules) {
    // Health probes are exempt from the general rate limit.
    const middleware = module.basePath === '/health' ? [] : [apiLimit];
    app.use(`${API_PREFIX}${module.basePath}`, ...middleware, module.router);
  }

  if (config.apiDocsEnabled) {
    const document = buildOpenApiDocument(modules);
    app.get('/api/docs/openapi.json', (_req, res) => {
      res.json(document);
    });
    app.use(
      '/api/docs',
      swaggerUi.serve,
      swaggerUi.setup(document, { customSiteTitle: 'API docs' }),
    );
  }

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
