/**
 * An expected failure with an HTTP status and a stable, machine-readable code.
 * Clients branch on `code`, never on the message, so messages can be reworded freely.
 */
export class AppError extends Error {
  override readonly name = 'AppError';
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message = 'Bad request', code = 'BAD_REQUEST', details?: unknown) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(message = 'Authentication required', code = 'UNAUTHORIZED') {
    return new AppError(401, code, message);
  }

  static forbidden(message = 'You do not have permission to do this', code = 'FORBIDDEN') {
    return new AppError(403, code, message);
  }

  static notFound(message = 'Not found', code = 'NOT_FOUND') {
    return new AppError(404, code, message);
  }

  static conflict(message: string, code = 'CONFLICT', details?: unknown) {
    return new AppError(409, code, message, details);
  }

  static unprocessable(message: string, code = 'UNPROCESSABLE', details?: unknown) {
    return new AppError(422, code, message, details);
  }

  static tooManyRequests(retryAfterSeconds: number) {
    return new AppError(429, 'TOO_MANY_REQUESTS', 'Too many requests. Please try again later.', {
      retryAfterSeconds,
    });
  }
}
