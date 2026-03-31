// error.middleware.ts
// Global error handler — registered last in app.ts so it catches errors
// thrown anywhere in the request pipeline.
//
// How Express error handling works:
//   - When you call next(error) from a route, or throw inside an async handler,
//     Express skips all normal middleware and jumps to the first error handler.
//   - An error handler has 4 parameters: (err, req, res, next)
//   - We always return JSON so the frontend gets a consistent error shape.

import { Request, Response, NextFunction } from 'express';

// AppError lets us throw custom errors with an HTTP status code and message.
// Usage: throw new AppError(404, 'Item not found')
export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// The actual Express error handler middleware
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  // next is required as 4th param for Express to recognise this as an error handler
  _next: NextFunction
): void {
  // Known application errors (we threw these intentionally)
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
    });
    return;
  }

  // Mongoose validation error (e.g. required field missing)
  if (err.name === 'ValidationError') {
    res.status(400).json({
      error: 'Validation failed',
      details: err.message,
    });
    return;
  }

  // Unknown/unexpected errors — log for debugging, but avoid leaking stack traces in production
  if (process.env['NODE_ENV'] === 'production') {
    // Structured one-liner: easy to parse in log aggregators, no stack trace leak
    console.error(JSON.stringify({
      level:   'error',
      message: err.message,
      name:    err.name,
      path:    req.path,
      method:  req.method,
      time:    new Date().toISOString(),
    }));
  } else {
    // In development, print the full stack trace for easier debugging
    console.error('[Unhandled Error]', err);
  }

  res.status(500).json({
    error: 'Internal server error',
  });
}
