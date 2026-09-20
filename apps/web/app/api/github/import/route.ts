import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { currentGitHubSession } from '@/lib/github-auth';
import { importGitHubRepository } from '@/lib/control-plane';
const input = z.object({ owner: z.string().min(1), name: z.string().min(1) });
export async function POST(request: Request) {
  try {
    const session = await currentGitHubSession();
    if (!session) throw new Error('Sign in with GitHub before importing a repository');
    return NextResponse.json(await importGitHubRepository({ ...input.parse(await request.json()), token: session.token }), { status: 201 });
  } catch (error) { return apiError(error); }
}
