import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

export function apiError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Request failed';
  const status = error instanceof ZodError ? 400 : /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: { message, classification: status === 422 ? 'BLOCKED' : 'PERMANENT_FAILURE' } }, { status });
}
