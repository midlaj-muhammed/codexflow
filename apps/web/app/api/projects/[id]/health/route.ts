import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { inspectProjectHealth } from '@/lib/control-plane';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ health: await inspectProjectHealth(id) });
  } catch (error) {
    return apiError(error);
  }
}
