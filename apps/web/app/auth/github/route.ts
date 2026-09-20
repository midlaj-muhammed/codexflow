import { NextResponse } from 'next/server';
import { beginGitHubOAuth, githubOAuthOrigin } from '@/lib/github-auth';
export async function GET(request: Request) {
  const origin = githubOAuthOrigin(new URL(request.url).origin);
  try {
    return NextResponse.redirect(await beginGitHubOAuth(origin));
  } catch (error) {
    return NextResponse.redirect(
      new URL(
        `/?authError=${encodeURIComponent(error instanceof Error ? error.message : 'GitHub authentication failed')}`,
        origin,
      ),
    );
  }
}
