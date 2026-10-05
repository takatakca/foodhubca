import { NextResponse } from 'next/server';
import { inspectCredentialReadiness } from '@/lib/backend/credential-onboarding-service';
import { parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { withPerm } from '@/lib/foodhub/auth';
import { fail } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Read-only: which server-side variables exist (names only, never values).
export const GET = withPerm('analytics:view', async (req) => {
  const requested = new URL(req.url).searchParams.get('platform') || 'clover';
  let platform;
  try { platform = parsePlatformKey(requested); } catch { return fail(`Unsupported platform: ${requested}`); }
  return NextResponse.json(inspectCredentialReadiness(platform));
});
