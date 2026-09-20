import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { oauthConfigured, currentGitHubSession } from '@/lib/github-auth';

export async function GET() {
  try {
    const session = await currentGitHubSession();
    return NextResponse.json({ github: session ? { connected: true, login: session.login, oauth: true } : { connected: false, oauthConfigured: oauthConfigured() } });
  } catch (error) {
    return apiError(error);
  }
}
