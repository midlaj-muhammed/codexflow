import { NextResponse } from 'next/server';
import { ApprovalService } from '@codexflow/agents';
import { apiError } from '@/lib/api';
import { controlPlane, deliverApprovedTask, taskSnapshot } from '@/lib/control-plane';

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const snapshot = taskSnapshot(id);
    if (!snapshot?.workspace) throw new Error('Approval requires an active workspace');
    let approval = snapshot.approval;
    if (snapshot.task.status === 'READY_FOR_APPROVAL') {
      const diff = (await controlPlane().git.diff(String(snapshot.workspace.rootPath))).stdout;
      approval = new ApprovalService(controlPlane().store).approve(id, 'web-user', diff);
      controlPlane().store.transitionTask(id, 'APPROVED');
    } else if (snapshot.task.status !== 'APPROVED' || approval?.state !== 'APPROVED') {
      throw new Error('Task is not ready for approval');
    }
    const pullRequest = await deliverApprovedTask(id);
    return NextResponse.json({ approval, pullRequest, task: taskSnapshot(id) });
  } catch (error) {
    return apiError(error);
  }
}
