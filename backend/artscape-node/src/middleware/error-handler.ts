import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError } from '../utils/errors';
import { logger } from '../observability/logger';

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'ROUTE_NOT_FOUND', message: `Route not found: ${req.method} ${req.path}` },
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: error.issues },
    });
    return;
  }
  if (error instanceof AppError) {
    res.status(error.statusCode).json({
      success: false,
      error: { code: error.code, message: error.message, details: error.details },
    });
    return;
  }
  logger.error({ err: error, requestId: res.getHeader('x-request-id'), method: req.method, path: req.path }, 'Unhandled request error');
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'An internal error occurred.' },
  });
};

export function asyncHandler(
  handler: (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => Promise<void>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res).catch(next);
  };
}
