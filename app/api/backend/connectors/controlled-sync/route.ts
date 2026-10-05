import { NextResponse } from 'next/server';
import { parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { runControlledLiveSync } from '@/lib/backend/live-sync-orchestrator';
import { withPerm } from '@/lib/foodhub/auth';
import { readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Non-persisting live sync preview (calls the platform) — admin only.
export const POST = withPerm('admin', async (req) => {
  try {
    const body = await readJson(req);
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
});
