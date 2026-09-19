import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { controlPlane, taskSnapshot } from '@/lib/control-plane';

const terminal = new Set(['APPLIED', 'REJECTED', 'ROLLED_BACK', 'FAILED', 'CANCELLED', 'BLOCKED']);

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const snapshot = taskSnapshot(id);
    if (!snapshot) throw new Error('Task not found');
    if (terminal.has(String(snapshot.task.status))) throw new Error('Task cannot be cancelled in its current state');
    const cancelled = await controlPlane().runtime.cancel(id);
    if (!cancelled) throw new Error('Task cannot be cancelled in its current state');
    return NextResponse.json({ task: taskSnapshot(id) });
  } catch (error) {
    return apiError(error);
  }
}
