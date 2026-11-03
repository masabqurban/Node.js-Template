import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z, type ZodType } from 'zod';
import type { ZodOpenApiOperationObject, ZodOpenApiPathsObject } from 'zod-openapi';

import type { AuthContext } from '../../types/express.js';
import type { Permission } from '../auth/permissions.js';
import { AppError } from '../errors/app-error.js';
import { errorEnvelope, pageMetaSchema, type PageMeta } from './schemas.js';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

/** Auth middleware the routes need, injected so shared code never imports a module. */
export type Guards = {
  authenticate: RequestHandler;
  requirePermission: (permission: Permission) => RequestHandler;
};

type HandlerContext<B, Q, P> = {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  /** The signed-in user. Throws 401 on a route without `auth`. */
  readonly auth: AuthContext;
};

type Result<R extends ZodType | null> = R extends ZodType
  ? { data: z.input<R>; meta?: PageMeta; status?: number }
  : undefined;

type RouteDefinition<
  B extends ZodType,
  Q extends ZodType,
  P extends ZodType,
  R extends ZodType | null,
> = {
  method: Method;
  /** Express-style path relative to the module base, e.g. `/:id`. */
  path: string;
  summary: string;
  description?: string;
  /** `true` = any signed-in user; a permission = signed in and allowed to do it. */
  auth?: true | Permission;
  /** Extra middleware, e.g. a stricter rate limit. Runs after auth, before validation. */
  middleware?: RequestHandler[];
  request?: { body?: B; query?: Q; params?: P };
  /**
   * Schema of `data` in the success envelope. Responses are parsed through it,
   * so fields it doesn't declare (password hashes…) can never leave the API.
   * `null` = 204 No Content.
   */
  response: R;
  /** Success status, default 200. */
  status?: number;
  /** Extra error statuses to document, with a short reason. */
  errors?: Record<number, string>;
  handler: (
    ctx: HandlerContext<z.output<B>, z.output<Q>, z.output<P>>,
  ) => Promise<Result<R>> | Result<R>;
};

export type RouteModule = {
  basePath: string;
  router: Router;
  paths: ZodOpenApiPathsObject;
};

const COMMON_ERRORS: Record<number, string> = {
  400: 'Validation error',
  429: 'Rate limit exceeded',
  500: 'Unexpected server error',
};
const AUTH_ERRORS: Record<number, string> = {
  401: 'Missing, invalid or expired access token, or the session has ended',
};

/**
 * One definition per endpoint drives everything: request validation, the
 * typed handler, response filtering, and the OpenAPI document. The docs can't
 * drift from the code because they are generated from it.
 */
export function defineRoutes(options: { basePath: string; tag: string; guards: Guards }) {
  const router = Router();
  const paths: ZodOpenApiPathsObject = {};

  function route<
    B extends ZodType = ZodType<undefined>,
    Q extends ZodType = ZodType<undefined>,
    P extends ZodType = ZodType<undefined>,
    R extends ZodType | null = ZodType,
  >(def: RouteDefinition<B, Q, P, R>) {
    const guards: RequestHandler[] = [];
    if (def.auth) guards.push(options.guards.authenticate);
    if (def.auth && def.auth !== true) guards.push(options.guards.requirePermission(def.auth));

    const handler: RequestHandler = async (req, res) => {
      const ctx = {
        req,
        res,
        body: def.request?.body?.parse(req.body) as z.output<B>,
        query: def.request?.query?.parse(req.query) as z.output<Q>,
        params: def.request?.params?.parse(req.params) as z.output<P>,
        get auth() {
          if (!req.auth) throw AppError.unauthorized();
          return req.auth;
        },
      };

      const result = (await def.handler(ctx)) as
        { data: unknown; meta?: PageMeta; status?: number } | undefined;

      if (def.response === null || !result) {
        res.status(204).end();
        return;
      }
      const data = def.response.parse(result.data);
      res.status(result.status ?? def.status ?? 200).json({
        success: true,
        data,
        ...(result.meta ? { meta: result.meta } : {}),
      });
    };

    router[def.method](def.path, ...guards, ...(def.middleware ?? []), handler);
    document(def);
  }

  function document(def: RouteDefinition<ZodType, ZodType, ZodType, ZodType | null>) {
    const fullPath = `/api/v1${options.basePath}${def.path === '/' ? '' : def.path}`.replace(
      /:(\w+)/g,
      '{$1}',
    );
    const errors = {
      ...COMMON_ERRORS,
      ...(def.auth ? AUTH_ERRORS : {}),
      ...(def.auth && def.auth !== true ? { 403: `Requires the \`${def.auth}\` permission` } : {}),
      ...def.errors,
    };

    const success =
      def.response === null
        ? { 204: { description: 'No content' } }
        : {
            [def.status ?? 200]: {
              description: 'Success',
              content: {
                'application/json': {
                  schema: z.object({
                    success: z.literal(true),
                    data: def.response,
                    ...(def.response instanceof z.ZodArray ? { meta: pageMetaSchema } : {}),
                  }),
                },
              },
            },
          };

    const operation: ZodOpenApiOperationObject = {
      tags: [options.tag],
      summary: def.summary,
      ...(def.description ? { description: def.description } : {}),
      ...(def.auth ? { security: [{ bearerAuth: [] }] } : {}),
      requestParams: {
        ...(def.request?.query ? { query: def.request.query as z.ZodObject } : {}),
        ...(def.request?.params ? { path: def.request.params as z.ZodObject } : {}),
      },
      ...(def.request?.body
        ? { requestBody: { content: { 'application/json': { schema: def.request.body } } } }
        : {}),
      responses: {
        ...success,
        ...Object.fromEntries(
          Object.entries(errors).map(([status, description]) => [
            status,
            { description, content: { 'application/json': { schema: errorEnvelope } } },
          ]),
        ),
      },
    };

    paths[fullPath] = { ...paths[fullPath], [def.method]: operation };
  }

  return { route, module: { basePath: options.basePath, router, paths } satisfies RouteModule };
}
