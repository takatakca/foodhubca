import { NextResponse } from 'next/server';
import { releaseSha } from '@/lib/foodhub/release';
import releaseProbe from '@/lib/foodhub/release-probe.json';

export const dynamic = 'force-dynamic';

// Public release proof for deployment automation: commit SHA only, no settings or secrets.
export async function GET() {
  const sha = releaseSha();
  return NextResponse.json({
    ok: Boolean(sha),
    app: 'foodhub',
    sha: sha || null,
    shortSha: sha ? sha.slice(0, 7) : null,
    probeIdentity: releaseProbe.capability,
    at: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
