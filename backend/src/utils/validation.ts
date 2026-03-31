// validation.ts
// Shared helpers for validating request parameters.

import { AppError } from '../middleware/error.middleware';

/**
 * Parse a string into a positive integer.
 * Throws a 400 AppError if the value is missing, not a number, or ≤ 0.
 *
 * Usage in route handlers:
 *   const typeId = parsePositiveInt(req.params['typeId'], 'typeId');
 */
export function parsePositiveInt(val: string | undefined, name: string): number {
  if (!val) throw new AppError(400, `${name} is required`);
  const num = parseInt(val, 10);
  if (!Number.isInteger(num) || num <= 0) {
    throw new AppError(400, `${name} must be a positive integer`);
  }
  return num;
}
