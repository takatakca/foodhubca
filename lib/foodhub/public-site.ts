// The public, indexable part of foodhub.on2go.ca: the ON2GO Hub pages (/hub in French, /en/hub in English), robots.txt,
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

/** May be indexed: the public site, the legal pages and the app icons (/icons/: the Organization logo in the structured
 * data and the site icons must be crawlable and indexable). Every other response gets X-Robots-Tag: noindex. */
export function isIndexablePath(pathname: string): boolean {
  return isPublicSitePath(pathname) || pathname === '/legal' || pathname.startsWith('/legal/') || pathname.startsWith('/icons/');
}

/** FOODHUB_PUBLIC_HOME: on by default; "off" (or false / 0 / no) keeps "/" → /login for anonymous visitors. */
export function publicHomeEnabled(raw: string | null | undefined = typeof process !== 'undefined' ? process.env.FOODHUB_PUBLIC_HOME : undefined): boolean {
  return !/^(off|false|0|no)$/i.test(String(raw ?? '').trim());
}
