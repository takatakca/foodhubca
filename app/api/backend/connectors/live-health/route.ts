import { NextResponse } from 'next/server';
import { getLiveConnector, listLiveConnectors, parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { logConnectorHealth } from '@/lib/backend/connector-run-service';
import { withPerm } from '@/lib/foodhub/auth';

export const dynamic = 'force-dynamic';

// Makes real platform calls (when the live switch allows it) — admin only.
export const GET = withPerm('admin', async (req) => {
  try {
    const platform = new URL(req.url).searchParams.get('platform');
    const connectors = platform ? [getLiveConnector(parsePlatformKey(platform))] : listLiveConnectors();
    const results = [];
    for (const connector of connectors) {
      const result = await connector.testConnection();
      await logConnectorHealth(result);
      results.push(result);
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error);
    const status = message.startsWith('Unsupported platform') ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
});
