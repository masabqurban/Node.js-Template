import type { ErrorRequestHandler, RequestHandler } from 'express';
import { z } from 'zod';

import { AppError } from '../errors/app-error.js';

type ErrorBody = { code: string; message: string; details?: unknown };

function send(res: Parameters<ErrorRequestHandler>[2], status: number, error: ErrorBody) {
  res.status(status).json({ success: false, error });
}

/** Unknown routes become a JSON 404 in the standard envelope. */
export const notFound: RequestHandler = (req, _res, next) => {
  next(AppError.notFound(`Route ${req.method} ${req.path} not found`, 'ROUTE_NOT_FOUND'));
};

/**
 * The single place errors become HTTP responses. Expected errors keep their
 * code and message; anything unexpected is logged in full and returned as a
 * generic 500, so stack traces and internals never reach the client.
 */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, _next) => {
  if (err instanceof AppError) {
    if (err.status === 429) {
      const details = err.details as { retryAfterSeconds?: number } | undefined;
      res.setHeader('Retry-After', String(details?.retryAfterSeconds ?? 60));
    }
    send(res, err.status, { code: err.code, message: err.message, details: err.details });
    return;
  }

  if (err instanceof z.ZodError) {
    send(res, 400, {
      code: 'VALIDATION_ERROR',
      message: 'The request is invalid.',
      details: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    });
    return;
  }

  // Errors raised by express.json() carry a `type` from the body-parser package.
  const type = (err as { type?: unknown }).type;
  if (type === 'entity.parse.failed') {
    send(res, 400, { code: 'INVALID_JSON', message: 'The request body is not valid JSON.' });
    return;
  }
  if (type === 'entity.too.large') {
    send(res, 413, { code: 'PAYLOAD_TOO_LARGE', message: 'The request body is too large.' });
    return;
  }

  req.log.error({ err }, 'Unhandled error');
  send(res, 500, { code: 'INTERNAL_SERVER_ERROR', message: 'Something went wrong.' });
};
