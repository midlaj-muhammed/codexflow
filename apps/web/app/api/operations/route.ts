import { NextResponse } from 'next/server';
import { operationsSnapshot } from '@/lib/control-plane';

export function GET() {
  return NextResponse.json({ operations: operationsSnapshot() });
}
