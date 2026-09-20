import { NextResponse } from 'next/server';
import { completeGitHubOAuth } from '@/lib/github-auth';
export async function GET(request: Request) {
  const url = new URL(request.url); const error = url.searchParams.get('error');
  if (error) return NextResponse.redirect(new URL(`/?authError=${encodeURIComponent('GitHub authorization was denied or cancelled')}`, url));
  try { await completeGitHubOAuth(url.origin, url.searchParams.get('code') ?? '', url.searchParams.get('state') ?? ''); return NextResponse.redirect(new URL('/app', url)); }
  catch (cause) { return NextResponse.redirect(new URL(`/?authError=${encodeURIComponent(cause instanceof Error ? cause.message : 'GitHub authentication failed')}`, url)); }
}
