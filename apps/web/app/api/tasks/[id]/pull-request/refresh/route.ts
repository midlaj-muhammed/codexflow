import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { refreshTaskPullRequest, taskSnapshot } from '@/lib/control-plane';

/** Server-side GitHub refresh. It never trusts a browser-provided SHA or PR number. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const refresh = await refreshTaskPullRequest(id);
    return NextResponse.json({ refresh, task: taskSnapshot(id) });
  } catch (error) {
    return apiError(error);
  }
}
