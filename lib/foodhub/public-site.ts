// The public, indexable part of foodhub.on2go.ca: the ON2GO.ca pages (/hub in French, /en/hub in English), robots.txt,
// sitemap.xml, llms.txt, the share images (/og/) and the favicon. Everything else stays behind the sign-in (proxy.ts)
// and carries "X-Robots-Tag: noindex" so the console never lands in a search engine, even through a stray link.
// No imports: proxy.ts loads this file on every request.

export type PublicLang = 'fr' | 'en';

/** Request header set by proxy.ts on the public pages: getLang() honours it first, so /en/hub is English whatever the cookie. */
export const PUBLIC_LANG_HEADER = 'x-fh-public-lang';

/** Where an anonymous visitor on "/" goes (unless FOODHUB_PUBLIC_HOME=off: then /login, as before). */
export const HUB_HOME = '/hub';

const PUBLIC_SITE_FILES = new Set(['/robots.txt', '/sitemap.xml', '/llms.txt', '/favicon.ico']);

/** Language of a public hub page from its path: /hub… = French, /en/hub… = English, anything else = null. */
export function publicSiteLang(pathname: string): PublicLang | null {
  if (pathname === '/hub' || pathname.startsWith('/hub/')) return 'fr';
  if (pathname === '/en/hub' || pathname.startsWith('/en/hub/')) return 'en';
  return null;
}

/** Reachable without a sign-in. "/hubx" or "/hub-admin" are not: the match is exact or on "/hub/". */
export function isPublicSitePath(pathname: string): boolean {
  return publicSiteLang(pathname) !== null || PUBLIC_SITE_FILES.has(pathname) || pathname.startsWith('/og/');
}

/** A storefront ordering page or its sitemap (/commander/<slug>, /commander/sitemap.xml: lib/foodhub/storefront/seo.ts),
 * never an order-tracking page (/commander/<slug>/suivi/<token>: one customer's order) or the QR image. */
export function isStorefrontIndexablePath(pathname: string): boolean {
  if (!pathname.startsWith('/commander/')) return false;
  return pathname.slice('/commander/'.length).split('/').filter(Boolean).length === 1;
}

/** May be indexed: the public site, the legal pages, the storefront ordering pages (/commander/<slug>), the app icons
 * (/icons/: the Organization logo in the structured data and the site icons must be crawlable and indexable) and the
 * menu photos (/media/: the dish photos that the public directory feed sends to on2go.ca, which must stay eligible for
 * image search). Every other response gets X-Robots-Tag: noindex. (The legal pages carry their own meta robots noindex
 * while they are drafts: app/legal/layout.tsx; a storefront page that is off says noindex in its own metadata.) */
export function isIndexablePath(pathname: string): boolean {
  return isPublicSitePath(pathname) || pathname === '/legal' || pathname.startsWith('/legal/') || pathname.startsWith('/icons/')
    || pathname.startsWith('/media/') || isStorefrontIndexablePath(pathname);
}

/** Cache-Control of the public hub pages: they only change when an env variable changes (which needs a restart), so a
 * browser may keep them 5 minutes and a CDN an hour, then serve the old copy while it revalidates. */
export const PUBLIC_PAGE_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

/** FOODHUB_PUBLIC_HOME: on by default; "off" (or false / 0 / no) keeps "/" → /login for anonymous visitors. */
export function publicHomeEnabled(raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_PUBLIC_HOME : undefined): boolean {
  return !/^(off|false|0|no)$/i.test(String(raw ?? '').trim());
}
