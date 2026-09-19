import { NextResponse } from 'next/server';
import { ApprovalService } from '@codexflow/agents';
import { apiError } from '@/lib/api';
import { controlPlane, taskSnapshot } from '@/lib/control-plane';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const snapshot = taskSnapshot(id);
    if (!snapshot?.approval) throw new Error('No approval request exists for this task');
    const approval = new ApprovalService(controlPlane().store).reject(id);
    if (snapshot.task.status === 'READY_FOR_APPROVAL') controlPlane().store.transitionTask(id, 'REJECTED');
    return NextResponse.json({ approval, task: taskSnapshot(id) });
  } catch (error) {
    return apiError(error);
  }
}
