import { NextResponse } from 'next/server';
import { operationsSnapshot } from '@/lib/control-plane';

/** Readiness proves the server can open the durable control-plane store. */
export function GET() {
  const operations = operationsSnapshot();
  return NextResponse.json({ service: 'CodexFlow', status: 'ready', execution: operations.execution });
}
