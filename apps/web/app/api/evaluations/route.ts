import { NextResponse } from 'next/server';
import { evaluationSnapshot } from '@/lib/control-plane';

export async function GET() {
  return NextResponse.json(evaluationSnapshot());
}
