import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { publishProjectToGitHub } from '@/lib/control-plane';

const input = z.object({ name: z.string().trim().min(1).max(100), private: z.boolean().default(true) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json({ publication: await publishProjectToGitHub({ projectId: id, ...input.parse(await request.json()) }) });
  } catch (error) {
    return apiError(error);
  }
}
