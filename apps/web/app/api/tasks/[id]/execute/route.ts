import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { startTaskExecution, taskSnapshot } from '@/lib/control-plane';

export const runtime = 'nodejs';

const taskId = z.string().uuid();

/** HTTP adapter only: RuntimeExecutor owns workspace and agent orchestration. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const idValue = taskId.parse(id);
    const started = startTaskExecution(idValue);
    const snapshot = taskSnapshot(idValue);
    return NextResponse.json(
      {
        taskId: idValue,
        accepted: started.started,
        status: snapshot?.task.status ?? 'QUEUED',
        task: snapshot,
      },
      { status: started.started ? 202 : 409 },
    );
  } catch (error) {
    return apiError(error);
  }
}
