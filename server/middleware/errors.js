import { AppError } from '../utils/errors.js';

export function notFoundApi(req, res) {
  res.status(404).json({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Unknown API endpoint.' } });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  let status = 500;
  let error = { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' };
  if (err instanceof AppError) {
    status = err.status;
    error = { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) };
  } else if (err.type === 'entity.parse.failed') {
    status = 400;
    error = { code: 'INVALID_JSON', message: 'Request body is not valid JSON.' };
  } else if (err.type === 'entity.too.large') {
    status = 413;
    error = { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' };
  } else {
    // Never leak internals to the client, but never fail silently either.
    console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  }
  res.status(status).json({ success: false, data: null, error });
}

export function securityHeaders(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; object-src 'none'; frame-ancestors 'none'",
  });
  next();
}
