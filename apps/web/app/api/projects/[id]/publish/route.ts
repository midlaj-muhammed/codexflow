import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { publishProjectToGitHub } from '@/lib/control-plane';
import { currentGitHubSession } from '@/lib/github-auth';

const input = z.object({ name: z.string().trim().min(1).max(100), private: z.boolean().default(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await currentGitHubSession();
    if (!session) return apiError(new Error('Connect GitHub before publishing this project'));
    return NextResponse.json({ publication: await publishProjectToGitHub({ projectId: id, ...input.parse(await request.json()), token: session.token }) });
  } catch (error) {
    return apiError(error);
  }
}
