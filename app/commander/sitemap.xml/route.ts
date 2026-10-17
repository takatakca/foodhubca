import { sitemapXml } from '@/lib/foodhub/storefront/seo';
import { brandLive, getStorefrontSettings } from '@/lib/foodhub/storefront/settings';

export const dynamic = 'force-dynamic';

// /commander/sitemap.xml: the live ordering pages only (master switch on and brand on), each with its English alternate.
// Submit it in Google Search Console (docs/STOREFRONT.md); the site-wide sitemap is owned elsewhere.
export async function GET() {
  const s = await getStorefrontSettings();
  const entries = Object.values(s.brands).filter((b) => brandLive(s, b)).map((b) => ({ slug: b.slug, ...(s.updatedAt ? { lastmod: s.updatedAt.slice(0, 10) } : {}) }));
  return new Response(sitemapXml(entries), { headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=600' } });
}
