import { NextResponse } from 'next/server';
import { allowedOrigin } from '@/lib/foodhub/public-directory';
import { trackOrder } from '@/lib/foodhub/storefront/checkout';

export const dynamic = 'force-dynamic';

// Tracking of an ordering-page order (public, proxy.ts): the random token is the only key. Returns the order number,
// status, brand and ready time — never the customer, the items or the money. ?slug=<page> also checks the brand.
// The token stops working 7 days after the order. CORS for the ON2GO sites (allowedOrigin), so on2go.ca can show
// the status on its own tracking page.
type Ctx = { params: Promise<{ token: string }> };

function cors(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' } : { Vary: 'Origin' };
}

export async function GET(req: Request, ctx: Ctx) {
  const { token } = await ctx.params;
  const slug = new URL(req.url).searchParams.get('slug') ?? undefined;
  const view = await trackOrder(token, slug !== undefined ? { slug } : {});
  if (!view) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
  return NextResponse.json({ ok: true, ...view }, { headers: { ...cors(req), 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Max-Age': '600' } });
}
