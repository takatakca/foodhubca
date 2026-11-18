import { NextResponse, type NextRequest } from 'next/server';
import { skipAdapter } from '@/lib/foodhub/adapters/skip';
import { applyCourierUpdate, skipCourierStatus } from '@/lib/foodhub/courier';
import { background, parseJson, unauthorized } from '@/lib/foodhub/webhook-utils';
import { readTextOr413 } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// JET Connect "Driver Status Notification": { orderID, driverStatus: { code }, happenedAt }
// codes: driverArrivingAtRestaurant, driverAtRestaurant, onItsWay, delivered. JET expects 200 + the same payload back.
export async function POST(req: NextRequest) {
  const read = await readTextOr413(req);
  if ('response' in read) return read.response;
  const raw = read.text;
  if (!skipAdapter.verifyWebhook(req.headers, raw)) return unauthorized('skip');
  const body = parseJson(raw);
  if (!body?.orderID) return NextResponse.json({ error: 'orderID missing' }, { status: 400 });
  const status = skipCourierStatus(body.driverStatus?.code);
  if (status) background(`skip driver ${body.orderID}`, () => applyCourierUpdate('skip', String(body.orderID), { status }, 'skip:driver_status'), { channel: 'skip', body, reference: String(body.orderID), kind: 'order' });
  return NextResponse.json(body, { status: 200 });
}
