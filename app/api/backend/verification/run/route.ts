import { NextResponse } from 'next/server';
import { localSeed } from '@/lib/data/local-seed';
import { runVerification } from '@/lib/backend/verification-engine';

export async function POST() {
  return NextResponse.json({ ok: true, verification: runVerification(localSeed.doordashStores) });
}
