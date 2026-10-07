import { NextResponse, type NextRequest } from 'next/server';
import { parseGenericOrder, tgtgAdapter } from '@/lib/foodhub/adapters/partner';
import { background, intakeUnavailable, keepUnparsed, parseJson, queueOrder, unauthorized } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Too Good To Go bag orders (when a partner feed is enabled). Token protected.
// Unknown shapes are kept under Channels → Unparsed payloads, never lost.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!tgtgAdapter.verifyWebhook(req.headers, raw)) return unauthorized('tgtg');
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const order = parseGenericOrder('tgtg', 'tgtg', body);
  if (!order) {
    background('keep unparsed tgtg', () => keepUnparsed('tgtg', body, 'Payload shape not recognized yet'));
    return NextResponse.json({ ok: true, stored: 'unparsed' });
  }
  if (!(await queueOrder(order))) return intakeUnavailable();
  return NextResponse.json({ ok: true });
}
