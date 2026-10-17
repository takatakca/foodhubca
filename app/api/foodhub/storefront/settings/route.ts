import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { paylinkReadiness } from '@/lib/foodhub/delivery/paylink';
import { effectiveHours, getHours } from '@/lib/foodhub/hours';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { clearStorefrontCache } from '@/lib/foodhub/storefront/catalog';
import { ordersBySource } from '@/lib/foodhub/storefront/checkout';
import { trustProxy } from '@/lib/foodhub/session';
import { qrSvg } from '@/lib/foodhub/storefront/qr';
import { pageUrl } from '@/lib/foodhub/storefront/seo';
import { getStorefrontSettings, saveStorefrontSettings, seedBrandOf, storefrontSwitch, type StorefrontSettings } from '@/lib/foodhub/storefront/settings';

export const dynamic = 'force-dynamic';

// Settings of the ordering pages ("Commander direct"), signed in. Not under /api/storefront/ (that prefix is public).
//   GET  (view)      settings, master switch (and whether the server forces it), per brand: address, kitchen, payment
//                    readiness (Clover Hosted Checkout, no texts needed), hours set or not; orders by source (7 days).
//   GET ?qr=<slug>[&table=N]   the QR code SVG of that page (preview / print before the brand goes live).
//   PUT  (menu:edit) saves the settings.
async function view(settings: StorefrontSettings) {
  const [catalog, hours, bySource] = await Promise.all([getCatalog(), getHours(), ordersBySource(7)]);
  const brands = await Promise.all(Object.entries(settings.brands).map(async ([name, b]) => {
    const ready = await paylinkReadiness(name, b.locationCode, { needSms: false }).catch((e) => ({ ok: false, reason: e instanceof Error ? e.message : String(e) }));
    return {
      name, ...b, url: pageUrl(b.slug), color: seedBrandOf(name)?.color ?? null,
      hoursSet: Boolean(effectiveHours(hours, name, b.locationCode)),
      payReady: { ok: ready.ok, ...(ready.reason ? { reason: ready.reason } : {}) },
    };
  }));
  return {
    settings: { enabled: settings.enabled, updatedAt: settings.updatedAt ?? null, updatedBy: settings.updatedBy ?? null },
    switch: storefrontSwitch(settings),
    brands,
    locations: catalog.locations.filter((l) => l.active).map((l) => ({ code: l.code, name: l.name })),
    bySource,
    publicBase: publicBaseUrl(),
    https: /^https:\/\//.test(publicBaseUrl()),
    trustProxy: trustProxy(),
  };
}

export const GET = withPerm('view', async (req) => {
  const q = new URL(req.url).searchParams;
  const slug = q.get('qr');
  if (slug) {
    const s = await getStorefrontSettings();
    if (!Object.values(s.brands).some((b) => b.slug === slug)) return fail('Unknown page.', 404);
    const table = (q.get('table') ?? '').match(/^\d{1,3}$/)?.[0];
    const target = `${pageUrl(slug)}?src=qr${table ? `&table=${table}` : ''}`;
    return new Response(qrSvg(target, { title: target }), { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
      ...(q.get('download') === '1' ? { 'Content-Disposition': `attachment; filename="qr-${slug}${table ? `-table-${table}` : ''}.svg"` } : {}) } });
  }
  return ok(await view(await getStorefrontSettings()));
});

export const PUT = withPerm('menu:edit', async (req, _ctx, actor) => {
  const body = await readJson(req);
  let saved: StorefrontSettings;
  try {
    saved = await saveStorefrontSettings(body, actor);
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  clearStorefrontCache();
  return ok(await view(saved));
});
