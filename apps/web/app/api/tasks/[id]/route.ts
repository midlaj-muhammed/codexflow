import { NextResponse } from 'next/server';
import { taskSnapshot } from '@/lib/control-plane';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = taskSnapshot(id);
  return task
    ? NextResponse.json({ task })
    : NextResponse.json({ error: { message: 'Task not found', classification: 'PERMANENT_FAILURE' } }, { status: 404 });
}
