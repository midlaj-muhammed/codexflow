import { NextResponse } from 'next/server';
import { z } from 'zod';
import { apiError } from '@/lib/api';
import { importLocalRepository } from '@/lib/control-plane';

const input = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  url: z.url(),
  defaultBranch: z.string().min(1),
  localPath: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const value = input.parse(await request.json());
    return NextResponse.json(await importLocalRepository({ provider: 'github', ...value }), { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
