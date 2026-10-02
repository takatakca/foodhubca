import { NextResponse } from 'next/server';
import { parsePlatformKey } from '@/lib/backend/connectors/live-registry';

export async function POST(request: Request, context: { params: Promise<{ platform: string }> }) {
  const { platform } = await context.params;
  const platformKey = parsePlatformKey(platform);
  const rawPayload = await request.json().catch(() => ({}));

  // Webhook signature validation must be implemented per platform before enabling production webhook processing.
  // For safety, this endpoint records/returns received payload shape only and does not mutate ledger/accounting state.
  return NextResponse.json({
    platformKey,
    status: 'received_not_processed',
    message: 'Webhook endpoint is ready, but signature validation + processing must be enabled per platform.',
    receivedKeys: Object.keys(rawPayload || {}),
  });
}
