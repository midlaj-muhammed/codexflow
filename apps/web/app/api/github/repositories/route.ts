import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { githubRepositories } from '@/lib/control-plane';
import { currentGitHubSession } from '@/lib/github-auth';

export async function GET() {
  try {
    const session = await currentGitHubSession();
    if (!session) throw new Error('Sign in with GitHub before browsing repositories');
    return NextResponse.json({ repositories: await githubRepositories(session.token) });
  } catch (error) {
    return apiError(error);
  }
}
