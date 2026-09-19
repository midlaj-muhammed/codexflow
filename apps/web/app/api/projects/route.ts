import { NextResponse } from 'next/server';
import { controlPlane } from '@/lib/control-plane';

export async function GET() {
  return NextResponse.json({ projects: controlPlane().store.listProjects() });
}
