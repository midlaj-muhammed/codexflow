import { NextResponse } from 'next/server';
import { completeGitHubOAuth, githubOAuthOrigin } from '@/lib/github-auth';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  const origin = githubOAuthOrigin(url.origin);
  if (error)
    return NextResponse.redirect(
      new URL(
        `/?authError=${encodeURIComponent('GitHub authorization was denied or cancelled')}`,
        origin,
      ),
    );
  try {
    await completeGitHubOAuth(
      origin,
      url.searchParams.get('code') ?? '',
      url.searchParams.get('state') ?? '',
    );
    return NextResponse.redirect(new URL('/app', origin));
  } catch (cause) {
    return NextResponse.redirect(
      new URL(
        `/?authError=${encodeURIComponent(cause instanceof Error ? cause.message : 'GitHub authentication failed')}`,
        origin,
      ),
    );
  }
}
