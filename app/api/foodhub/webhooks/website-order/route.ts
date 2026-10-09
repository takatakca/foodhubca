import { NextResponse } from 'next/server';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { receiveWebsiteOrder, verifyWebsiteOrder } from '@/lib/foodhub/delivery/website';
import { parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Our own website's orders (see lib/foodhub/delivery/website.ts for the payload).
export async function POST(req: Request) {
  if (!verifyWebsiteOrder(req.headers)) return NextResponse.json({ ok: false, error: 'Token check failed.' }, { status: 401 });
  if (!(await featureOn('delivery'))) return NextResponse.json({ ok: false, error: 'Own orders are turned off in Food Hub (Settings → Expansion).' }, { status: 503 });
  const body = parseJson(await req.text());
  if (body === undefined) return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  const r = await receiveWebsiteOrder(body);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, duplicate: r.duplicate, number: r.order.number, id: r.order.id, total: r.order.total });
}
