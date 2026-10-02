import { NextRequest, NextResponse } from 'next/server';
import { getLiveConnector, listLiveConnectors, parsePlatformKey } from '@/lib/backend/connectors/live-registry';
import { logConnectorHealth } from '@/lib/backend/connector-run-service';

export async function GET(request: NextRequest) {
  try {
    const platform = request.nextUrl.searchParams.get('platform');
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
}
