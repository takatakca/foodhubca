import { NextResponse } from 'next/server';
import { parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { runControlledLiveSync } from '@/lib/backend/live-sync-orchestrator';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const platformKey = parsePlatformKey(body.platformKey || 'clover');
    const syncType = body.syncType || 'orders';
    const result = await runControlledLiveSync(platformKey, {
      syncType,
      startDate: body.startDate || body.windowStart,
      endDate: body.endDate || body.windowEnd,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status = message.startsWith('Unsupported platform') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
