import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { githubRepositories } from '@/lib/control-plane';

export async function GET() {
  try {
    return NextResponse.json({ repositories: await githubRepositories() });
  } catch (error) {
    return apiError(error);
  }
}
