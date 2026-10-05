export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new AppError(400, 'bad_request', message, details);
export const unauthorized = (message = 'Please sign in') => new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You are not allowed to do this') => new AppError(403, 'forbidden', message);
export const notFound = (what: string) => new AppError(404, 'not_found', `${what} not found`);
export const conflict = (message: string, details?: unknown) => new AppError(409, 'conflict', message, details);

/** Another user saved the record after this client loaded it. */
export const stale = (current: unknown) =>
  new AppError(409, 'stale', 'This record was changed by someone else. Reload it and apply your edit again.', { current });
