// The public ON2GO Hub site on foodhub.on2go.ca (spec: private SEO plan § 8): metadata, structured data (JSON-LD),
// sitemap entries and llms.txt for the pages in app/hub and app/en/hub. The words live in public-hub-content.ts; the
// product facts come from the Clover App Market listing (clover-listing.ts) and the prices from pricing.ts, so the
// site, the listing and the structured data never drift apart.
//
// Environment (all optional, read at request time):
//   FOODHUB_APP_MARKET_URL   the listing's public address once Clover approves it (https://…clover.com/…). Empty =
//                            "Coming soon to the Clover App Market", prices labelled "Planned launch pricing", no Offer.
//   FOODHUB_APP_MARKET_STATUS "review" once the owner has really submitted the listing ("under review by Clover");
//                            anything else = "coming soon". Ignored once FOODHUB_APP_MARKET_URL is set.
//   FOODHUB_PUBLIC_LIVE_PLATFORMS  the platforms that approved the integration (uber,doordash,skip; unset = uber). The
//                            others show "in certification" and their pages stay out of the index, sitemap and llms.txt.
//   FOODHUB_PUBLIC_SAME_AS   comma-separated public profile links (LinkedIn, YouTube…) for the Organization's sameAs.
//   FOODHUB_PUBLIC_URL       the canonical base (https://foodhub.on2go.ca), shared with the rest of the app. In
//                            production a base that is not https falls back to https://foodhub.on2go.ca (with a warning),
//                            so canonicals, the sitemap and the JSON-LD never point at localhost.

import type { Metadata } from 'next';
import { LISTING_BENEFITS, LISTING_DESCRIPTION } from './clover-listing';
import { legalInfo, LEGAL_PATHS } from './legal';
import {
  appMarketStatus, appMarketUrl, HUB_PLATFORMS, livePlatforms, PRICING, PRICING_STATEMENT, STANDARD_MONTHLY_CAD, TRIAL_DAYS,
  type AppMarketStatus, type HubPlatform, type Lang,
} from './pricing';
import { CLOVER_APP_NAME } from './product';
import { HUB_CONTENT, HUB_PAGE_KEYS, HUB_PATHS, HUB_TAGLINE, HUB_UI, PLATFORM_NAME, type Card, type Faq, type HubPageKey } from './public-hub-content';
import { publicBaseUrl } from './config';

export { HUB_CONTENT, HUB_PAGE_KEYS, HUB_PATHS, type HubPageKey };

export const HUB_NAME = 'ON2GO Hub';
/** The Clover App Market name, protected (renaming it needs a new Clover review). */
export const HUB_ALT_NAME = CLOVER_APP_NAME;
export const OG_IMAGE: Record<Lang, string> = { fr: '/og/hub-fr.png', en: '/og/hub-en.png' };
export const LOCALE: Record<Lang, string> = { fr: 'fr-CA', en: 'en-CA' };
/** The production address of the public site: the canonical base whenever FOODHUB_PUBLIC_URL is unusable in production. */
export const HUB_PRODUCTION_BASE = 'https://foodhub.on2go.ca';

let warnedBase = false;
/** The canonical base of the public pages. In production, a base that is not https (FOODHUB_PUBLIC_URL unset → the
 * localhost default, or a typo) would make every canonical, hreflang, sitemap entry and JSON-LD @id point elsewhere and
 * get the pages dropped: it falls back to HUB_PRODUCTION_BASE and logs a warning once. */
export function hubBase(base = publicBaseUrl(), nodeEnv: string | undefined = process.env.NODE_ENV): string {
  if (nodeEnv !== 'production' || /^https:\/\/[^/\s]+$/i.test(base)) return base;
  if (!warnedBase) {
    warnedBase = true;
    console.warn(`[public-hub] FOODHUB_PUBLIC_URL is "${base}" in production: the public pages use ${HUB_PRODUCTION_BASE} instead.`);
  }
  return HUB_PRODUCTION_BASE;
}

/** Everything a page needs from the environment, read once per request (the page component itself stays pure). */
export interface HubContext {
  base: string;
  appMarketUrl: string | null;
  sameAs: string[];
  supportEmail: string | null;
  company: string;
  address: string;
  /** "soon" | "review" | "live" (pricing.ts appMarketStatus). */
  marketStatus: AppMarketStatus;
  /** Platforms whose integration may be presented as live; the others are "in certification". */
  livePlatforms: HubPlatform[];
}

export function publicSameAs(raw: string | null | undefined = process.env.FOODHUB_PUBLIC_SAME_AS): string[] {
  const out: string[] = [];
  for (const part of String(raw ?? '').split(',')) {
    const v = part.trim();
    if (!v) continue;
    try {
      const u = new URL(v);
      if (u.protocol === 'https:' && !u.username && !u.password && !out.includes(u.toString())) out.push(u.toString());
    } catch { /* not a link: ignored */ }
  }
  return out.slice(0, 10);
}

export function hubContext(): HubContext {
  const info = legalInfo();
  const market = appMarketUrl();
  return {
    base: hubBase(),
    appMarketUrl: market,
    sameAs: publicSameAs(),
    supportEmail: info.supportEmail,
    company: info.company,
    address: info.address,
    marketStatus: appMarketStatus(market),
    livePlatforms: livePlatforms(),
  };
}

type LiveCtx = Partial<Pick<HubContext, 'livePlatforms'>>;
const liveOf = (ctx: LiveCtx) => ctx.livePlatforms ?? livePlatforms(null);

/** The platforms whose integration is not approved yet (shown "in certification"), in page order. */
export function pendingPlatforms(ctx: LiveCtx): HubPlatform[] {
  const live = liveOf(ctx);
  return HUB_PLATFORMS.filter((p) => !live.includes(p));
}

/** "DoorDash et SkipTheDishes" / "DoorDash and SkipTheDishes". */
export function platformList(platforms: HubPlatform[], lang: Lang): string {
  const names = platforms.map((p) => PLATFORM_NAME[p]);
  return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')}${HUB_UI[lang].and}${names[names.length - 1]}`;
}

/** False for an integration page whose platform has not approved the integration yet: noindex, and left out of the
 * sitemap and llms.txt (a page about an integration the platform has not certified is not promoted). */
export function hubIndexable(key: HubPageKey, ctx: LiveCtx): boolean {
  const platform = HUB_CONTENT[key].fr.platform;
  return !platform || liveOf(ctx).includes(platform);
}

/** « Intégration en cours de certification avec DoorDash. » on a page whose platform is pending, else null. */
export function hubCertificationNote(key: HubPageKey, lang: Lang, ctx: LiveCtx): string | null {
  const platform = HUB_CONTENT[key][lang].platform;
  if (!platform || hubIndexable(key, ctx)) return null;
  return HUB_UI[lang].certification.replace('{platform}', PLATFORM_NAME[platform]);
}

export function hubUrl(base: string, key: HubPageKey, lang: Lang): string {
  return `${base}${HUB_PATHS[key][lang]}`;
}

/** The page at a path, e.g. "/en/hub/pricing" → { key: 'pricing', lang: 'en' }. */
export function hubPageAt(pathname: string): { key: HubPageKey; lang: Lang } | null {
  const p = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  for (const key of HUB_PAGE_KEYS) for (const lang of ['fr', 'en'] as const) if (HUB_PATHS[key][lang] === p) return { key, lang };
  return null;
}

/** The page for a catch-all route's slug (app/hub/[[...slug]] = French, app/en/hub/[[...slug]] = English). */
export function hubPageForSlug(lang: Lang, slug: string[] | undefined): HubPageKey | null {
  const path = `${lang === 'fr' ? '/hub' : '/en/hub'}${slug?.length ? `/${slug.join('/')}` : ''}`;
  const hit = hubPageAt(path);
  return hit && hit.lang === lang ? hit.key : null;
}

// ---------------------------------------------------------------------------------------------------------------
// Product facts from the Clover App Market listing (one source).

/** The hub's own tagline (not the listing's: that one names Too Good To Go without its condition). */
export const hubTagline = (lang: Lang) => HUB_TAGLINE[lang];
export const hubBenefits = (lang: Lang) => LISTING_BENEFITS.map((b) => b[lang]);

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The listing description's "• Title: text" bullets, as cards. */
export function hubFeatures(lang: Lang): Card[] {
  return LISTING_DESCRIPTION[lang].split('\n')
    .filter((l) => l.startsWith('• '))
    .map((l) => {
      const body = l.slice(2);
      const m = body.match(/^([^:]+?)\s?:\s(.*)$/);
      return m ? { title: m[1].trim(), text: capital(m[2].trim()) } : { title: '', text: body };
    });
}

/** The listing's requirements sentence, without its "Requirements:" lead. */
export function hubRequirements(lang: Lang): string {
  const line = LISTING_DESCRIPTION[lang].split('\n').find((l) => /^(Ce qu’il faut|Requirements)\s?:/.test(l)) ?? '';
  return capital(line.replace(/^(Ce qu’il faut|Requirements)\s?:\s*/, '').replace(/TAKATAK Food Hub/g, HUB_NAME));
}

/** " : " in French, ": " in English. */
export const colon = (lang: Lang) => (lang === 'fr' ? ' : ' : ': ');

type FillCtx = Pick<HubContext, 'company' | 'appMarketUrl'> & LiveCtx;

/** Fills the content's per-request tokens: {company} (legal name), {planned} (the launch-pricing note while the app
 * is not on the Clover App Market) and {pending} (the platforms still in certification). */
export function fillHub(text: string, lang: Lang, ctx: FillCtx): string {
  const pending = pendingPlatforms(ctx);
  return text
    .replace(/\{company\}/g, ctx.company)
    .replace(/\{planned\}/g, ctx.appMarketUrl ? '' : HUB_UI[lang].plannedNote)
    .replace(/\{pending\}/g, pending.length ? HUB_UI[lang].pending.replace('{platforms}', platformList(pending, lang)) : '');
}

/** A page's FAQ with its tokens filled: the same list feeds the visible FAQ and the FAQPage structured data. */
export function hubFaq(key: HubPageKey, lang: Lang, ctx: FillCtx): Faq[] {
  return HUB_CONTENT[key][lang].faq.map((f) => ({ q: fillHub(f.q, lang, ctx), a: fillHub(f.a, lang, ctx) }));
}

// ---------------------------------------------------------------------------------------------------------------
// Metadata

export function hubMetadata(key: HubPageKey, lang: Lang, ctx: Pick<HubContext, 'base'> & LiveCtx = { base: hubBase(), livePlatforms: livePlatforms() }): Metadata {
  const c = HUB_CONTENT[key][lang];
  const url = hubUrl(ctx.base, key, lang);
  const image = { url: `${ctx.base}${OG_IMAGE[lang]}`, width: 1200, height: 630, alt: `${HUB_NAME}${colon(lang)}${c.label}` };
  return {
    title: { absolute: c.title },
    description: c.description,
    alternates: {
      canonical: url,
      languages: { 'fr-CA': hubUrl(ctx.base, key, 'fr'), 'en-CA': hubUrl(ctx.base, key, 'en'), 'x-default': hubUrl(ctx.base, key, 'fr') },
    },
    robots: { index: hubIndexable(key, ctx), follow: true },
    openGraph: {
      type: 'website', url, siteName: HUB_NAME, title: c.title, description: c.description,
      locale: lang === 'fr' ? 'fr_CA' : 'en_CA', alternateLocale: [lang === 'fr' ? 'en_CA' : 'fr_CA'], images: [image],
    },
    twitter: { card: 'summary_large_image', title: c.title, description: c.description, images: [image.url] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Structured data (schema.org JSON-LD). Never a rating: there are no public reviews yet (Search Console's Software App
// report flags the missing offers / rating until the App Market link is set: expected, see docs/FOODHUB.md).
// The shared Organization and SoftwareApplication nodes keep one @id and one url (the French landing) on every page;
// only the WebPage node carries the page's own, language-specific url.

/** "6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada" → a PostalAddress (the whole text as the street otherwise). */
export function postalAddress(address: string): Record<string, string> {
  const m = address.match(/^(.+?),\s*([^,(]+?)\s*\((?:Québec|Quebec|QC)\)\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i);
  if (!m) return { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'CA' };
  return { '@type': 'PostalAddress', streetAddress: m[1].trim(), addressLocality: m[2].trim(), addressRegion: 'QC', postalCode: m[3].toUpperCase(), addressCountry: 'CA' };
}

export function hubJsonLd(key: HubPageKey, lang: Lang, ctx: HubContext): Record<string, unknown> {
  const c = HUB_CONTENT[key][lang];
  const url = hubUrl(ctx.base, key, lang);
  const home = hubUrl(ctx.base, 'landing', 'fr');
  const orgId = `${ctx.base}/hub#organization`;
  const appId = `${ctx.base}/hub#software`;
  const org: Record<string, unknown> = {
    '@type': 'Organization', '@id': orgId, name: HUB_NAME, alternateName: [HUB_ALT_NAME], legalName: ctx.company,
    url: home, logo: `${ctx.base}/icons/icon-512.png`, address: postalAddress(ctx.address),
    areaServed: { '@type': 'Country', name: 'Canada' },
  };
  if (ctx.supportEmail) org.email = ctx.supportEmail;
  if (ctx.supportEmail) org.contactPoint = { '@type': 'ContactPoint', contactType: 'customer support', email: ctx.supportEmail, availableLanguage: ['fr', 'en'] };
  if (ctx.sameAs.length) org.sameAs = ctx.sameAs;

  const app: Record<string, unknown> = {
    '@type': 'SoftwareApplication', '@id': appId, name: HUB_NAME, alternateName: HUB_ALT_NAME,
    applicationCategory: 'BusinessApplication', operatingSystem: 'Clover', inLanguage: ['fr-CA', 'en-CA'],
    description: hubTagline(lang), url: home, publisher: { '@id': orgId },
    featureList: hubBenefits(lang),
  };
  if (ctx.appMarketUrl) {
    const price = STANDARD_MONTHLY_CAD.toFixed(2);
    app.offers = {
      '@type': 'Offer', url: ctx.appMarketUrl, price, priceCurrency: PRICING.currency, availability: 'https://schema.org/InStock',
      eligibleRegion: { '@type': 'Country', name: 'Canada', identifier: PRICING.country }, description: PRICING_STATEMENT[lang],
      priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: PRICING.currency, billingDuration: 'P1M', unitCode: 'MON' },
    };
  }

  const page: Record<string, unknown> = {
    '@type': 'WebPage', '@id': `${url}#webpage`, url, name: c.title, description: c.description, inLanguage: LOCALE[lang],
    isPartOf: { '@type': 'WebSite', '@id': `${ctx.base}/hub#website`, name: HUB_NAME, url: home, publisher: { '@id': orgId } },
    about: { '@id': appId },
    primaryImageOfPage: { '@type': 'ImageObject', url: `${ctx.base}${OG_IMAGE[lang]}`, width: 1200, height: 630 },
  };
  const graph: Record<string, unknown>[] = [org, app, page];
  if (key !== 'landing') {
    graph.push({
      '@type': 'BreadcrumbList', '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: HUB_NAME, item: hubUrl(ctx.base, 'landing', lang) },
        { '@type': 'ListItem', position: 2, name: c.label, item: url },
      ],
    });
    page.breadcrumb = { '@id': `${url}#breadcrumb` };
  }
  const faq = hubFaq(key, lang, ctx);
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage', '@id': `${url}#faq`, inLanguage: LOCALE[lang],
      mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  }
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** JSON for a <script type="application/ld+json">: "<" escaped so no text can close the script tag. */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

// ---------------------------------------------------------------------------------------------------------------
// Sitemap and llms.txt

export interface SitemapEntry { url: string; alternates?: { languages: Record<string, string> } }

/** The legal pages go in the sitemap (and llms.txt) only once the owner approved them (FOODHUB_LEGAL_APPROVED=true):
 * a draft with its banner is not something to promote. Same for an integration page whose platform has not approved
 * the integration yet (hubIndexable). */
export function hubSitemap(base = hubBase(), legalApproved = legalInfo().approved, live: HubPlatform[] = livePlatforms()): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const key of HUB_PAGE_KEYS) {
    if (!hubIndexable(key, { livePlatforms: live })) continue;
    const languages = { 'fr-CA': hubUrl(base, key, 'fr'), 'en-CA': hubUrl(base, key, 'en'), 'x-default': hubUrl(base, key, 'fr') };
    for (const lang of ['fr', 'en'] as const) out.push({ url: hubUrl(base, key, lang), alternates: { languages } });
  }
  if (legalApproved) for (const p of [LEGAL_PATHS.support, LEGAL_PATHS.privacy, LEGAL_PATHS.terms]) out.push({ url: `${base}${p}` });
  return out;
}

/** Only the API is blocked. Every other private page (payment links, tickets, courier, kitchen, console) is left
 * crawlable on purpose: proxy.ts answers it with "X-Robots-Tag: noindex", which a crawler only sees if it may fetch the
 * page (a blocked URL can still be indexed from a stray link), and robots.txt never lists the private paths. */
export function hubRobots(base = hubBase()) {
  return {
    rules: [{
      userAgent: '*',
      allow: ['/hub', '/en/hub', '/legal/', '/llms.txt', '/og/', '/icons/'],
      disallow: ['/api/'],
    }],
    sitemap: `${base}/sitemap.xml`,
  };
}

/** Plain-text summary for AI assistants (llms.txt): French first, then English. Facts only. */
export function hubLlmsTxt(ctx: HubContext = hubContext(), legalApproved = legalInfo().approved): string {
  const block = (lang: Lang) => {
    const fr = lang === 'fr';
    const ui = HUB_UI[lang];
    const market = ctx.appMarketUrl
      ? `${ui.marketLive}${colon(lang)}${ctx.appMarketUrl}`
      : `${ctx.marketStatus === 'review' ? ui.marketReviewNote : ui.marketSoonNote} ${ui.plannedPricing}.`;
    const pending = pendingPlatforms(ctx);
    const lines = [
      fr ? '## Français' : '## English',
      '',
      `> ${hubTagline(lang)}`,
      '',
      fr
        ? `${HUB_NAME} (nom sur le Clover App Market : ${HUB_ALT_NAME}) est une application pour restaurants qui utilisent Clover, au Canada. Elle reçoit les commandes des plateformes de livraison par l’API de chaque plateforme, sans agrégateur, et les met dans la caisse Clover. Conçue à Montréal par ${ctx.company}, utilisée dans les restaurants ON2GO (https://on2go.ca/).`
        : `${HUB_NAME} (Clover App Market name: ${HUB_ALT_NAME}) is an app for restaurants that use Clover, in Canada. It receives delivery platform orders through each platform’s own API, with no aggregator, and puts them in the Clover register. Built in Montréal by ${ctx.company}, used in the ON2GO restaurants (https://on2go.ca/).`,
      '',
      fr ? '### Fonctions' : '### Features',
      ...hubFeatures(lang).map((f) => `- ${f.title}${colon(lang)}${f.text}`),
      '',
      ...(pending.length ? [ui.pending.trim().replace('{platforms}', platformList(pending, lang))] : []),
      '',
      fr ? '### Préalables' : '### Requirements',
      hubRequirements(lang),
      '',
      fr ? '### Tarifs' : '### Pricing',
      PRICING_STATEMENT[lang],
      market,
      fr ? `Téléphone IA : bientôt, application distincte avec son propre essai gratuit de ${TRIAL_DAYS} jours et son propre abonnement.` : `AI phone: coming soon, a separate app with its own ${TRIAL_DAYS}-day free trial and its own subscription.`,
      '',
      fr ? '### Pages' : '### Pages',
      ...HUB_PAGE_KEYS.filter((k) => hubIndexable(k, ctx)).map((k) => `- [${HUB_CONTENT[k][lang].label}](${hubUrl(ctx.base, k, lang)})`),
      ...(legalApproved ? [
        `- [${fr ? 'Soutien' : 'Support'}](${ctx.base}${LEGAL_PATHS.support})`,
        `- [${fr ? 'Confidentialité' : 'Privacy'}](${ctx.base}${LEGAL_PATHS.privacy})`,
        `- [${fr ? 'Conditions' : 'Terms'}](${ctx.base}${LEGAL_PATHS.terms})`,
      ] : []),
    ];
    if (ctx.supportEmail) lines.push('', `Contact${colon(lang)}${ctx.supportEmail}`);
    return lines.join('\n');
  };
  return [`# ${HUB_NAME}`, '', block('fr'), '', block('en'), ''].join('\n');
}
