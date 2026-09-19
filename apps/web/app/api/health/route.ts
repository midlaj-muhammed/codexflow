import { NextResponse } from 'next/server';

import { getPublicEnvironment } from '@/lib/environment';

export function GET() {
  const environment = getPublicEnvironment();

  return NextResponse.json({
    service: environment.appName,
    status: 'ok',
  });
}
