import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export class ApiActionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed';
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  const details =
    error && typeof error === 'object' && 'details' in error
      ? (error.details as Record<string, unknown> | undefined)
      : undefined;
  const status =
    error instanceof ZodError
      ? 400
      : code === 'DUPLICATE_EXECUTION'
        ? 409
        : /not found/i.test(message)
          ? 404
          : 422;
  const classification = status === 409 ? 'RETRYABLE' : status === 422 ? 'BLOCKED' : 'PERMANENT_FAILURE';
  return NextResponse.json({ error: { message, code, classification, details } }, { status });
}
