import { NextResponse } from 'next/server';
import { disconnectGitHub, githubOAuthOrigin } from '@/lib/github-auth';
export async function POST(request: Request) {
  await disconnectGitHub();
  return NextResponse.redirect(new URL('/', githubOAuthOrigin(new URL(request.url).origin)));
}
