import { NextResponse } from 'next/server';
import { beginGitHubOAuth } from '@/lib/github-auth';
export async function GET(request: Request) {
  try { return NextResponse.redirect(await beginGitHubOAuth(new URL(request.url).origin)); }
  catch (error) { return NextResponse.redirect(new URL(`/?authError=${encodeURIComponent(error instanceof Error ? error.message : 'GitHub authentication failed')}`, request.url)); }
}
