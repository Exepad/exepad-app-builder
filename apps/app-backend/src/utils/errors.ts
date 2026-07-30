/**
 * Structured error types for App Backend
 */

export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'EMAIL_NOT_VERIFIED'
  | 'METHOD_NOT_ALLOWED'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'
  | 'DATABASE_ERROR'
  | 'HANDLER_ERROR';

export interface ErrorDetails {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
  field?: string;
}

/**
 * Base error class for App Backend errors
 */
export class WorkerError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: Record<string, unknown>;
  public readonly field?: string;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number = 500,
    details?: Record<string, unknown>,
    field?: string
  ) {
    super(message);
    this.name = 'WorkerError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.field = field;
  }

  toJSON(): ErrorDetails {
    return {
      code: this.code,
      message: this.message,
      ...(this.details && { details: this.details }),
      ...(this.field && { field: this.field }),
    };
  }
}

/**
 * Invalid request error (400)
 */
export class InvalidRequestError extends WorkerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('INVALID_REQUEST', message, 400, details);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends WorkerError {
  constructor(message: string, field?: string, details?: Record<string, unknown>) {
    super('VALIDATION_ERROR', message, 400, details, field);
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends WorkerError {
  constructor(resource: string, id?: string | number) {
    const message = id ? `${resource} with id '${id}' not found` : `${resource} not found`;
    super('NOT_FOUND', message, 404, { resource, id });
  }
}

/**
 * Unauthorized error (401)
 */
export class UnauthorizedError extends WorkerError {
  constructor(message: string = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
  }
}

/**
 * Forbidden error (403)
 */
export class ForbiddenError extends WorkerError {
  constructor(message: string = 'Access denied') {
    super('FORBIDDEN', message, 403);
  }
}

/**
 * Email-not-verified error (403) — thrown by auth handlers when
 * `security.requireVerification === true` and the user's email hasn't been
 * verified yet. Client branches on `error.code === 'EMAIL_NOT_VERIFIED'` to
 * render a "check your email" UI with a resend button.
 */
export class EmailNotVerifiedError extends WorkerError {
  constructor(message: string = 'Email not verified') {
    super('EMAIL_NOT_VERIFIED', message, 403);
  }
}

/**
 * Method not allowed error (405)
 */
export class MethodNotAllowedError extends WorkerError {
  constructor(method: string) {
    super('METHOD_NOT_ALLOWED', `Method '${method}' not found`, 405, { method });
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends WorkerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('CONFLICT', message, 409, details);
  }
}

/**
 * Database error (500)
 */
export class DatabaseError extends WorkerError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('DATABASE_ERROR', message, 500, details);
  }
}

/**
 * Generic internal error (500) — use when a downstream service
 * (email, external API) fails in a way the user can retry.
 */
export class InternalError extends WorkerError {
  constructor(message: string = 'Internal server error', details?: Record<string, unknown>) {
    super('INTERNAL_ERROR', message, 500, details);
  }
}

/**
 * Handler execution error (500)
 */
export class HandlerError extends WorkerError {
  constructor(handlerName: string, message: string, details?: Record<string, unknown>) {
    super('HANDLER_ERROR', `Handler '${handlerName}' failed: ${message}`, 500, {
      handler: handlerName,
      ...details,
    });
  }
}

/**
 * Create error response JSON
 */
export function errorResponse(error: WorkerError | Error): Response {
  if (error instanceof WorkerError) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.toJSON(),
      }),
      {
        status: error.statusCode,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }

  // Generic error
  return new Response(
    JSON.stringify({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: error.message || 'An unexpected error occurred',
      },
    }),
    {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}
