import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed';
  const code =
    error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined;
  const status =
    error instanceof ZodError
      ? 400
      : code === 'DUPLICATE_EXECUTION'
        ? 409
        : /not found/i.test(message)
          ? 404
          : 422;
  const classification = status === 409 ? 'RETRYABLE' : status === 422 ? 'BLOCKED' : 'PERMANENT_FAILURE';
  return NextResponse.json({ error: { message, code, classification } }, { status });
}
