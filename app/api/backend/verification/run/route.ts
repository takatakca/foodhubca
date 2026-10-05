import { NextResponse } from 'next/server';
import { localSeed } from '@/lib/data/local-seed';
import { runVerification } from '@/lib/backend/verification-engine';
import { withPerm } from '@/lib/foodhub/auth';

export const dynamic = 'force-dynamic';

// Runs the 3-service rules on the seed snapshot (your screenshots) — same data as /verification.
export const POST = withPerm('admin', async () => {
  return NextResponse.json({ ok: true, source: 'seed_snapshot', verification: runVerification(localSeed.doordashStores) });
});
