import { NextResponse } from 'next/server';
import { placeStorefrontOrder } from '@/lib/foodhub/storefront/checkout';
import { sfText } from '@/lib/foodhub/storefront/i18n';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Checkout of the ordering page (public, proxy.ts). Same-origin only (no CORS). The body is at most 32 KB; the cart is
// validated (zod), priced again on the server, rate-limited per address and phone; a filled honeypot is refused.
const MAX_BYTES = 32 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' };

export async function POST(req: Request) {
  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) return NextResponse.json({ ok: false, error: sfText('fr').errors.tooBig }, { status: 413, headers: NO_STORE });
  let raw: string;
  try { raw = await req.text(); } catch { return NextResponse.json({ ok: false, error: sfText('fr').errors.invalid }, { status: 400, headers: NO_STORE }); }
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) return NextResponse.json({ ok: false, error: sfText('fr').errors.tooBig }, { status: 413, headers: NO_STORE });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, error: sfText('fr').errors.invalid }, { status: 400, headers: NO_STORE }); }
  try {
    const r = await placeStorefrontOrder(body, clientIp(req.headers));
    const { status, ...out } = r;
    return NextResponse.json(out, { status, headers: { ...NO_STORE, ...(!r.ok && r.retryAfterSec ? { 'Retry-After': String(r.retryAfterSec) } : {}) } });
  } catch (e) {
    console.error('[foodhub] storefront checkout error:', e);
    return NextResponse.json({ ok: false, error: sfText('fr').errors.generic }, { status: 500, headers: NO_STORE });
  }
}
