export class AppError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code = 'BAD_REQUEST',
    readonly details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function requireFound<T>(value: T | undefined | null, message: string): T {
  if (value === undefined || value === null) {
    throw new AppError(message, 404, 'NOT_FOUND');
  }
  return value;
}

