// Search and sharing for the ordering pages: page metadata (title, description, canonical, fr/en alternates,
// OpenGraph, Twitter), JSON-LD (Restaurant + Menu + OrderAction) and the /commander/sitemap.xml entries.
// Hours come from Food Hub's effective hours of the brand at its kitchen; unknown hours are left out (never a made-up
// schedule), and a whole-day slot is never published as a round-the-clock claim.
import type { Metadata } from 'next';
import { publicBaseUrl } from '../config';
import { DAYS, effectiveHours, normalizeWeek } from '../hours';
import type { HoursConfig, WeeklyHours } from '../types';
import type { PublicMenu } from './catalog';
import { sfText, type SfLang } from './i18n';

const SCHEMA_DAY: Record<string, string> = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday', thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

export const pageUrl = (slug: string) => `${publicBaseUrl()}/commander/${slug}`;

/** "/media/x.jpg" → absolute (crawlers and link previews need a full address). */
export function absoluteUrl(u: string | undefined): string | undefined {
  if (!u) return undefined;
  if (/^https?:\/\//i.test(u)) return u;
  return u.startsWith('/') ? `${publicBaseUrl()}${u}` : undefined;
}

export function firstPhoto(menu: PublicMenu): string | undefined {
  for (const c of menu.categories) for (const i of c.items) if (i.imageUrl) return absoluteUrl(i.imageUrl);
  return undefined;
}

const toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };

/**
 * schema.org opening hours of a week: slots that run past midnight (stored as 16:00–23:59 + 00:00–03:00) are joined
 * back into one 16:00–03:00 entry. Whole-day slots (00:00–23:59) are left out.
 */
export function openingHoursSpec(week: WeeklyHours | null): Array<{ '@type': 'OpeningHoursSpecification'; dayOfWeek: string; opens: string; closes: string }> {
  if (!week) return [];
  const w = normalizeWeek(week);
  // First pass: an evening slot ending 23:59 takes the next morning's 00:00 slot as its own end.
  const used = new Set<string>();
  const closesAt = new Map<string, string>();
  DAYS.forEach((day, i) => {
    for (const [k, s] of (w[day] ?? []).entries()) {
      if (s.close !== '23:59' || s.open === '00:00') continue;
      const next = DAYS[(i + 1) % 7];
      const j = (w[next] ?? []).findIndex((x) => x.open === '00:00' && x.close !== '23:59');
      if (j >= 0 && toMin(w[next][j].close) < toMin(s.open)) { closesAt.set(`${day}|${k}`, w[next][j].close); used.add(`${next}|${j}`); }
    }
  });
  const out: Array<{ '@type': 'OpeningHoursSpecification'; dayOfWeek: string; opens: string; closes: string }> = [];
  for (const day of DAYS) {
    for (const [k, s] of (w[day] ?? []).entries()) {
      if (used.has(`${day}|${k}`) || (s.open === '00:00' && s.close === '23:59')) continue;
      out.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: `https://schema.org/${SCHEMA_DAY[day]}`, opens: s.open, closes: closesAt.get(`${day}|${k}`) ?? s.close });
    }
  }
  return out;
}

export function storefrontJsonLd(menu: PublicMenu, opts: { hours: HoursConfig; brandName: string; locationCode: string; lang?: SfLang }): Record<string, unknown> {
  const url = pageUrl(menu.slug);
  const lang = opts.lang ?? 'fr';
  const phone = (process.env.FOODHUB_PUBLIC_PHONE || '').trim();
  const hours = openingHoursSpec(effectiveHours(opts.hours, opts.brandName, opts.locationCode));
  const image = firstPhoto(menu);
  const cuisine = menu.brand.cuisine[lang].length ? menu.brand.cuisine[lang] : menu.brand.cuisine.fr;
  const L = <T extends { name: string; nameFr?: string }>(x: T) => (lang === 'fr' ? x.nameFr || x.name : x.name);
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    '@id': `${url}#restaurant`,
    name: menu.brand.name,
    url,
    ...(image ? { image } : {}),
    ...(menu.brand.description ? { description: menu.brand.description[lang] } : {}),
    address: {
      '@type': 'PostalAddress', streetAddress: menu.location.street, addressLocality: menu.location.city, addressRegion: menu.location.region,
      postalCode: menu.location.postalCode, addressCountry: 'CA',
    },
    ...(menu.location.geo ? { geo: { '@type': 'GeoCoordinates', latitude: menu.location.geo.lat, longitude: menu.location.geo.lng } } : {}),
    ...(phone ? { telephone: phone } : {}),
    ...(cuisine.length ? { servesCuisine: cuisine } : {}),
    ...(hours.length ? { openingHoursSpecification: hours } : {}),
    acceptsReservations: false,
    hasMenu: {
      '@type': 'Menu',
      name: `${menu.brand.name} — Menu`,
      url,
      inLanguage: lang === 'fr' ? 'fr-CA' : 'en-CA',
      hasMenuSection: menu.categories.map((c) => ({
        '@type': 'MenuSection',
        name: L(c),
        hasMenuItem: c.items.map((i) => ({
          '@type': 'MenuItem',
          name: L(i),
          ...((lang === 'fr' ? i.descriptionFr || i.description : i.description) ? { description: lang === 'fr' ? i.descriptionFr || i.description : i.description } : {}),
          ...(absoluteUrl(i.imageUrl) ? { image: absoluteUrl(i.imageUrl) } : {}),
          offers: { '@type': 'Offer', price: i.price.toFixed(2), priceCurrency: 'CAD' },
        })),
      })),
    },
    potentialAction: {
      '@type': 'OrderAction',
      target: {
        '@type': 'EntryPoint', urlTemplate: `${url}?src=google`, inLanguage: 'fr-CA',
        actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'],
      },
      deliveryMethod: 'http://purl.org/goodrelations/v1#DeliveryModePickUp',
    },
  };
}

/** JSON for a <script type="application/ld+json">: "<" escaped so a menu text can never close the tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function storefrontMetadata(menu: PublicMenu, lang: SfLang): Metadata {
  const t = sfText(lang);
  const url = pageUrl(menu.slug);
  const title = `${menu.brand.name}: ${t.orderOnline}`;
  const description = t.metaDescription(menu.brand.name, menu.location.city);
  const image = firstPhoto(menu);
  const canonical = lang === 'fr' ? url : `${url}?lang=en`;
  return {
    title,
    description,
    alternates: { canonical, languages: { 'fr-CA': url, 'en-CA': `${url}?lang=en`, 'x-default': url } },
    openGraph: {
      type: 'website', url: canonical, title, description, siteName: menu.brand.name, locale: lang === 'fr' ? 'fr_CA' : 'en_CA',
      ...(image ? { images: [{ url: image, alt: menu.brand.name }] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description, ...(image ? { images: [image] } : {}) },
    robots: { index: true, follow: true },
  };
}

/** /commander/sitemap.xml: the live pages only, with their English alternate. */
export function sitemapXml(entries: Array<{ slug: string; lastmod?: string }>): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const urls = entries.map((e) => {
    const u = pageUrl(e.slug);
    return `<url><loc>${esc(u)}</loc>${e.lastmod ? `<lastmod>${esc(e.lastmod)}</lastmod>` : ''}<changefreq>daily</changefreq>`
      + `<xhtml:link rel="alternate" hreflang="fr-CA" href="${esc(u)}"/><xhtml:link rel="alternate" hreflang="en-CA" href="${esc(`${u}?lang=en`)}"/></url>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${urls}</urlset>\n`;
}
