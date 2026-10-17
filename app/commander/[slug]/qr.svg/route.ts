import { publicMenu } from '@/lib/foodhub/storefront/catalog';
import { qrSvg } from '@/lib/foodhub/storefront/qr';
import { pageUrl } from '@/lib/foodhub/storefront/seo';

export const dynamic = 'force-dynamic';

// QR code of a live ordering page: /commander/<slug>/qr.svg → /commander/<slug>?src=qr, ?table=12 → …&table=12 (one
// code per table). ?download=1 saves it as a file. Encoded in-house (lib/foodhub/storefront/qr.ts).
type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await publicMenu(slug))) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  const q = new URL(req.url).searchParams;
  const table = (q.get('table') ?? '').match(/^\d{1,3}$/)?.[0];
  const target = `${pageUrl(slug)}?src=qr${table ? `&table=${table}` : ''}`;
  return new Response(qrSvg(target, { title: target }), {
    headers: {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(q.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="qr-${slug}${table ? `-table-${table}` : ''}.svg"` } : {}),
    },
  });
}
