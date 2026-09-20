import { NextResponse } from 'next/server';
import { apiError } from '@/lib/api';
import { githubConnection } from '@/lib/control-plane';

export async function GET() {
  try {
    return NextResponse.json({ github: await githubConnection() });
  } catch (error) {
    return apiError(error);
  }
}
