import { NextResponse, type NextRequest } from 'next/server';
import { skipAdapter } from '@/lib/foodhub/adapters/skip';
import { parseSkipOrderTime } from '@/lib/foodhub/adapters/skip-api';
import { handleSkipOrderTime } from '@/lib/foodhub/skip-ops';
import { background, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET "Order time updated": { restaurantId, serviceType: Delivery|Collection, dayOfWeek, lowerBoundMinutes, upperBoundMinutes }.
// Kept on the store (meta.skipOrderTimes) so the screen can show the preparation window Skip promises customers.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  const n = parseSkipOrderTime(body);
  if (!n) return NextResponse.json({ error: 'restaurantId, serviceType and dayOfWeek are required' }, { status: 400 });
  background(`skip order time ${n.restaurantId}`, () => handleSkipOrderTime(n), { channel: 'skip', body, reference: n.restaurantId, kind: 'store_status' });
  return NextResponse.json({ ok: true }, { status: 200 });
}
