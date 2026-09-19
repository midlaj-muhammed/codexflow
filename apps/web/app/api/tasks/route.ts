import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { controlPlane, taskSnapshot } from '@/lib/control-plane';

const createTask = z.object({ projectId: z.string().uuid(), description: z.string().trim().min(3).max(10_000) });

export async function GET() {
  return NextResponse.json({ tasks: controlPlane().store.listTasks() });
}

export async function POST(request: Request) {
  try {
    const value = createTask.parse(await request.json());
    if (!controlPlane().store.getProject(value.projectId)) throw new Error('Project not found');
    const task = controlPlane().store.createTask(value.projectId, value.description);
    return NextResponse.json({ task: taskSnapshot(String(task.id)) }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
