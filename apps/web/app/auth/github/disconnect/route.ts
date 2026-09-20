import { NextResponse } from 'next/server';
import { disconnectGitHub } from '@/lib/github-auth';
export async function POST(request: Request) { await disconnectGitHub(); return NextResponse.redirect(new URL('/', request.url)); }
