import { NextResponse } from 'next/server';
import { getLiveConnector, parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { withPerm } from '@/lib/foodhub/auth';
import { readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Calls the platform (when the live switch allows it) — admin only.
export const POST = withPerm('admin', async (req) => {
  try {
    const body = await readJson(req);
    const platformKey = parsePlatformKey(body.platformKey);
    const connector = getLiveConnector(platformKey);
    const health = await connector.testConnection();
    if (!health.canCallLive) return NextResponse.json({ ok: false, blocked: true, health }, { status: 400 });
    const entities = await connector.autodiscover();
    return NextResponse.json({ ok: true, platformKey, count: entities.length, entities });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status = message.startsWith('Unsupported platform') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
});
