import { NextResponse } from 'next/server';
import { trackOrder } from '@/lib/foodhub/storefront/checkout';

export const dynamic = 'force-dynamic';

// Tracking of an ordering-page order (public, proxy.ts): the random token is the only key. Returns the order number,
// status, brand and ready time — never the customer, the items or the money.
type Ctx = { params: Promise<{ token: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const view = await trackOrder(token);
  if (!view) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json({ ok: true, ...view }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}
