import { NextResponse } from 'next/server';
import { allowedOrigin } from '@/lib/foodhub/public-directory';
import { publicMenu } from '@/lib/foodhub/storefront/catalog';

export const dynamic = 'force-dynamic';

// Public menu of a live ordering page (proxy.ts: /api/storefront/ is public). Public facts only: names, descriptions,
// photos, prices, choices, open state. Never Clover ids, notes, merchant or store ids. Cached 60 s. CORS for the
// ON2GO sites listed in public-directory.ts (allowedOrigin).
type Ctx = { params: Promise<{ slug: string }> };

function cors(req: Request): Record<string, string> {
  const origin = allowedOrigin(req.headers.get('origin'));
  return origin ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET, OPTIONS', Vary: 'Origin' } : { Vary: 'Origin' };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const menu = await publicMenu(slug);
  if (!menu) return NextResponse.json({ ok: false, error: 'Not found' }, { status: 404, headers: { ...cors(req), 'Cache-Control': 'no-store' } });
  return NextResponse.json({ ok: true, menu }, { headers: { ...cors(req), 'Cache-Control': 'public, max-age=60' } });
}

export async function OPTIONS(req: Request) {
  return new Response(null, { status: 204, headers: { ...cors(req), 'Access-Control-Max-Age': '600' } });
}
