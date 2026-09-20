import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiActionError, apiError } from '@/lib/api';
import { currentGitHubSession, githubAppInstallUrl } from '@/lib/github-auth';
import { importGitHubRepository } from '@/lib/control-plane';
const input = z.object({ owner: z.string().min(1), name: z.string().min(1) });
export async function POST(request: Request) {
  try {
    const session = await currentGitHubSession();
    if (!session) throw new Error('Sign in with GitHub before importing a repository');
    return NextResponse.json(await importGitHubRepository({ ...input.parse(await request.json()), token: session.token }), { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('GitHub App access is missing for this repository')
    ) {
      return apiError(
        new ApiActionError(error.message, 'GITHUB_APP_REPOSITORY_ACCESS_MISSING', {
          action: 'INSTALL_GITHUB_APP',
          installUrl: githubAppInstallUrl(),
        }),
      );
    }
    return apiError(error);
  }
}
