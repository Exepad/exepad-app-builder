/**
 * Tests for error classes and errorResponse utility
 */

import { describe, it, expect } from 'vitest';
import {
  WorkerError,
  InvalidRequestError,
  ValidationError,
  NotFoundError,
  UnauthorizedError,
  ForbiddenError,
  MethodNotAllowedError,
  ConflictError,
  DatabaseError,
  HandlerError,
  errorResponse,
} from '../src/utils/errors';

describe('WorkerError base class', () => {
  it('sets code, message, statusCode', () => {
    const err = new WorkerError('INTERNAL_ERROR', 'Something broke', 500);
    expect(err.code).toBe('INTERNAL_ERROR');
    expect(err.message).toBe('Something broke');
    expect(err.statusCode).toBe(500);
    expect(err.name).toBe('WorkerError');
    expect(err).toBeInstanceOf(Error);
  });

  it('includes optional details and field', () => {
    const err = new WorkerError('VALIDATION_ERROR', 'Bad', 400, { key: 'val' }, 'email');
    expect(err.details).toEqual({ key: 'val' });
    expect(err.field).toBe('email');
  });

  it('defaults statusCode to 500', () => {
    const err = new WorkerError('INTERNAL_ERROR', 'Fail');
    expect(err.statusCode).toBe(500);
  });

  it('toJSON includes code and message', () => {
    const err = new WorkerError('INTERNAL_ERROR', 'Msg', 500, { a: 1 }, 'f');
    const json = err.toJSON();
    expect(json.code).toBe('INTERNAL_ERROR');
    expect(json.message).toBe('Msg');
    expect(json.details).toEqual({ a: 1 });
    expect(json.field).toBe('f');
  });

  it('toJSON omits details and field when not set', () => {
    const err = new WorkerError('INTERNAL_ERROR', 'Msg');
    const json = err.toJSON();
    expect(json.details).toBeUndefined();
    expect(json.field).toBeUndefined();
  });
});

describe('InvalidRequestError', () => {
  it('has code INVALID_REQUEST and status 400', () => {
    const err = new InvalidRequestError('Bad input');
    expect(err.code).toBe('INVALID_REQUEST');
    expect(err.statusCode).toBe(400);
    expect(err.message).toBe('Bad input');
  });

  it('accepts optional details', () => {
    const err = new InvalidRequestError('Bad', { reason: 'missing' });
    expect(err.details).toEqual({ reason: 'missing' });
  });
});

describe('ValidationError', () => {
  it('has code VALIDATION_ERROR and status 400', () => {
    const err = new ValidationError('Invalid field');
    expect(err.code).toBe('VALIDATION_ERROR');
    expect(err.statusCode).toBe(400);
  });

  it('accepts field and details', () => {
    const err = new ValidationError('Bad email', 'email', { hint: 'use @' });
    expect(err.field).toBe('email');
    expect(err.details).toEqual({ hint: 'use @' });
  });
});

describe('NotFoundError', () => {
  it('has code NOT_FOUND and status 404', () => {
    const err = new NotFoundError('User');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.statusCode).toBe(404);
    expect(err.message).toBe('User not found');
  });

  it('includes id in message and details', () => {
    const err = new NotFoundError('Task', 42);
    expect(err.message).toBe("Task with id '42' not found");
    expect(err.details).toEqual({ resource: 'Task', id: 42 });
  });

  it('handles string id', () => {
    const err = new NotFoundError('Model', 'abc-123');
    expect(err.message).toContain('abc-123');
  });
});

describe('UnauthorizedError', () => {
  it('has code UNAUTHORIZED and status 401', () => {
    const err = new UnauthorizedError();
    expect(err.code).toBe('UNAUTHORIZED');
    expect(err.statusCode).toBe(401);
    expect(err.message).toBe('Authentication required');
  });

  it('accepts custom message', () => {
    const err = new UnauthorizedError('Token expired');
    expect(err.message).toBe('Token expired');
  });
});

describe('ForbiddenError', () => {
  it('has code FORBIDDEN and status 403', () => {
    const err = new ForbiddenError();
    expect(err.code).toBe('FORBIDDEN');
    expect(err.statusCode).toBe(403);
    expect(err.message).toBe('Access denied');
  });

  it('accepts custom message', () => {
    const err = new ForbiddenError('Admin only');
    expect(err.message).toBe('Admin only');
  });
});

describe('MethodNotAllowedError', () => {
  it('has code METHOD_NOT_ALLOWED and status 405', () => {
    const err = new MethodNotAllowedError('sys_noop');
    expect(err.code).toBe('METHOD_NOT_ALLOWED');
    expect(err.statusCode).toBe(405);
    expect(err.message).toBe("Method 'sys_noop' not found");
    expect(err.details).toEqual({ method: 'sys_noop' });
  });
});

describe('ConflictError', () => {
  it('has code CONFLICT and status 409', () => {
    const err = new ConflictError('Duplicate key');
    expect(err.code).toBe('CONFLICT');
    expect(err.statusCode).toBe(409);
    expect(err.message).toBe('Duplicate key');
  });

  it('accepts details', () => {
    const err = new ConflictError('Dup', { field: 'email' });
    expect(err.details).toEqual({ field: 'email' });
  });
});

describe('DatabaseError', () => {
  it('has code DATABASE_ERROR and status 500', () => {
    const err = new DatabaseError('Connection lost');
    expect(err.code).toBe('DATABASE_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe('Connection lost');
  });
});

describe('HandlerError', () => {
  it('has code HANDLER_ERROR and status 500', () => {
    const err = new HandlerError('myHandler', 'Null pointer');
    expect(err.code).toBe('HANDLER_ERROR');
    expect(err.statusCode).toBe(500);
    expect(err.message).toBe("Handler 'myHandler' failed: Null pointer");
    expect(err.details).toEqual({ handler: 'myHandler' });
  });

  it('merges additional details', () => {
    const err = new HandlerError('h', 'Fail', { extra: true });
    expect(err.details).toEqual({ handler: 'h', extra: true });
  });
});

describe('errorResponse', () => {
  it('returns proper response for WorkerError', async () => {
    const err = new ValidationError('Bad data', 'name');
    const res = errorResponse(err);

    expect(res.status).toBe(400);
    expect(res.headers.get('Content-Type')).toBe('application/json');

    const body = await res.json() as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('Bad data');
  });

  it('returns 500 for generic Error', async () => {
    const err = new Error('Something unexpected');
    const res = errorResponse(err);

    expect(res.status).toBe(500);

    const body = await res.json() as { success: boolean; error: { code: string; message: string } };
    expect(body.success).toBe(false);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toBe('Something unexpected');
  });

  it('handles Error with empty message', async () => {
    const err = new Error('');
    const res = errorResponse(err);

    const body = await res.json() as { error: { message: string } };
    expect(body.error.message).toBe('An unexpected error occurred');
  });

  it('preserves status code from subclasses', async () => {
    const err = new NotFoundError('Record', 5);
    const res = errorResponse(err);
    expect(res.status).toBe(404);
  });
});
