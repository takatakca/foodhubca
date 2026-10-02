import { NextResponse } from 'next/server';
import { inspectCredentialReadiness } from '@/lib/backend/credential-onboarding-service';
import { parsePlatformKey } from '@/lib/backend/connectors/live-registry';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = parsePlatformKey(searchParams.get('platform') || 'clover');
  return NextResponse.json(inspectCredentialReadiness(platform));
}
