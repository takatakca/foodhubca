import { NextResponse } from 'next/server';
import { getConnectors } from '@/lib/backend/connectors';

export async function GET() {
  const health = await Promise.all(getConnectors().map(async c => ({ platform: c.platform, mode: c.mode, ...(await c.health()) })));
  return NextResponse.json({ ok: true, health });
}
