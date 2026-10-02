import { NextRequest, NextResponse } from 'next/server';
import { getConnector, getConnectors } from '@/lib/backend/connectors';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const platform = body.platform as string | undefined;
  const connectors = platform ? [getConnector(platform)].filter(Boolean) : getConnectors();
  const results = [];
  for (const connector of connectors) {
    if (connector) results.push(await connector.discoverStores());
  }
  return NextResponse.json({ ok: true, results });
}
