import { NextResponse } from 'next/server';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { featureOn } from '@/lib/foodhub/expansion/features';
import { interacSummary } from '@/lib/foodhub/delivery/interac';
import { receiveWebsiteOrder, verifyWebsiteOrder } from '@/lib/foodhub/delivery/website';
import { parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Our own website's orders (see lib/foodhub/delivery/website.ts for the payload). An Interac order answers with the
// transfer instructions (recipient, exact amount, reference, expiry) — never the stored answer as a field of its own.
export async function POST(req: Request) {
  if (!verifyWebsiteOrder(req.headers)) return NextResponse.json({ ok: false, error: 'Token check failed.' }, { status: 401 });
  if (!(await featureOn('delivery'))) return NextResponse.json({ ok: false, error: 'Own orders are turned off in Food Hub (Settings → Expansion).' }, { status: 503 });
  const body = parseJson(await req.text());
  if (body === undefined) return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  const r = await receiveWebsiteOrder(body);
  if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: r.status });
  const o = r.order;
  return NextResponse.json({
    ok: true, duplicate: r.duplicate, number: o.number, id: o.id, total: o.total, status: o.status, payment: o.payment,
    ...(o.interac ? { interac: interacSummary(o) } : {}),
    ...(r.trackPath ? { trackUrl: `${publicBaseUrl()}${r.trackPath}` } : {}),
  });
}
