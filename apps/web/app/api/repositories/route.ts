import { NextResponse } from 'next/server';
import { controlPlane, repositorySnapshot } from '@/lib/control-plane';

export async function GET() {
  const repositories = await Promise.all(
    controlPlane().store.listRepositories().map(async (repository) => ({
      ...repository,
      git: await repositorySnapshot(repository),
    })),
  );
  return NextResponse.json({ repositories });
}
