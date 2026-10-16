// The public ON2GO Hub site on foodhub.on2go.ca (spec: private SEO plan § 8): metadata, structured data (JSON-LD),
// sitemap entries and llms.txt for the pages in app/hub and app/en/hub. The words live in public-hub-content.ts; the
// product facts come from the Clover App Market listing (clover-listing.ts) and the prices from pricing.ts, so the
// site, the listing and the structured data never drift apart.
//
// Environment (all optional, read at request time):
//   FOODHUB_APP_MARKET_URL   the listing's public address once Clover approves it (https://…clover.com/…). Empty =
//                            "Coming soon to the Clover App Market", prices labelled "Planned launch pricing", no Offer.
//   FOODHUB_PUBLIC_SAME_AS   comma-separated public profile links (LinkedIn, YouTube…) for the Organization's sameAs.
//   FOODHUB_PUBLIC_URL       the canonical base (https://foodhub.on2go.ca), shared with the rest of the app.

import type { Metadata } from 'next';
import { LISTING_BENEFITS, LISTING_DESCRIPTION, LISTING_TAGLINE } from './clover-listing';
import { legalInfo, LEGAL_PATHS } from './legal';
import { appMarketUrl, PRICING, PRICING_STATEMENT, STANDARD_MONTHLY_CAD, TRIAL_DAYS, type Lang } from './pricing';
import { CLOVER_APP_NAME } from './product';
import { HUB_CONTENT, HUB_PAGE_KEYS, HUB_PATHS, type Card, type HubPageKey } from './public-hub-content';
import { publicBaseUrl } from './config';

export { HUB_CONTENT, HUB_PAGE_KEYS, HUB_PATHS, type HubPageKey };

export const HUB_NAME = 'ON2GO Hub';
/** The Clover App Market name, protected (renaming it needs a new Clover review). */
export const HUB_ALT_NAME = CLOVER_APP_NAME;
export const OG_IMAGE: Record<Lang, string> = { fr: '/og/hub-fr.png', en: '/og/hub-en.png' };
export const LOCALE: Record<Lang, string> = { fr: 'fr-CA', en: 'en-CA' };

/** Everything a page needs from the environment, read once per request (the page component itself stays pure). */
export interface HubContext {
  base: string;
  appMarketUrl: string | null;
  sameAs: string[];
  supportEmail: string | null;
  company: string;
  address: string;
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
  return {
    base: publicBaseUrl(),
    appMarketUrl: appMarketUrl(),
    sameAs: publicSameAs(),
    supportEmail: info.supportEmail,
    company: info.company,
    address: info.address,
  };
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

export const hubTagline = (lang: Lang) => LISTING_TAGLINE[lang];
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

// ---------------------------------------------------------------------------------------------------------------
// Metadata

export function hubMetadata(key: HubPageKey, lang: Lang, ctx: Pick<HubContext, 'base'> = { base: publicBaseUrl() }): Metadata {
  const c = HUB_CONTENT[key][lang];
  const url = hubUrl(ctx.base, key, lang);
  const image = { url: `${ctx.base}${OG_IMAGE[lang]}`, width: 1200, height: 630, alt: `${HUB_NAME} : ${c.label}` };
  return {
    title: { absolute: c.title },
    description: c.description,
    alternates: {
      canonical: url,
      languages: { 'fr-CA': hubUrl(ctx.base, key, 'fr'), 'en-CA': hubUrl(ctx.base, key, 'en'), 'x-default': hubUrl(ctx.base, key, 'fr') },
    },
    robots: { index: true, follow: true },
    openGraph: {
      type: 'website', url, siteName: HUB_NAME, title: c.title, description: c.description,
      locale: lang === 'fr' ? 'fr_CA' : 'en_CA', alternateLocale: [lang === 'fr' ? 'en_CA' : 'fr_CA'], images: [image],
    },
    twitter: { card: 'summary_large_image', title: c.title, description: c.description, images: [image.url] },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Structured data (schema.org JSON-LD). Never a rating: there are no public reviews yet.

/** "6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada" → a PostalAddress (the whole text as the street otherwise). */
export function postalAddress(address: string): Record<string, string> {
  const m = address.match(/^(.+?),\s*([^,(]+?)\s*\((?:Québec|Quebec|QC)\)\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)/i);
  if (!m) return { '@type': 'PostalAddress', streetAddress: address, addressCountry: 'CA' };
  return { '@type': 'PostalAddress', streetAddress: m[1].trim(), addressLocality: m[2].trim(), addressRegion: 'QC', postalCode: m[3].toUpperCase(), addressCountry: 'CA' };
}

export function hubJsonLd(key: HubPageKey, lang: Lang, ctx: HubContext): Record<string, unknown> {
  const c = HUB_CONTENT[key][lang];
  const url = hubUrl(ctx.base, key, lang);
  const orgId = `${ctx.base}/hub#organization`;
  const appId = `${ctx.base}/hub#software`;
  const org: Record<string, unknown> = {
    '@type': 'Organization', '@id': orgId, name: HUB_NAME, alternateName: [HUB_ALT_NAME], legalName: ctx.company,
    url: hubUrl(ctx.base, 'landing', lang), logo: `${ctx.base}/icons/icon-512.png`, address: postalAddress(ctx.address),
    areaServed: { '@type': 'Country', name: 'Canada' },
  };
  if (ctx.supportEmail) org.email = ctx.supportEmail;
  if (ctx.supportEmail) org.contactPoint = { '@type': 'ContactPoint', contactType: 'customer support', email: ctx.supportEmail, availableLanguage: ['fr', 'en'] };
  if (ctx.sameAs.length) org.sameAs = ctx.sameAs;

  const app: Record<string, unknown> = {
    '@type': 'SoftwareApplication', '@id': appId, name: HUB_NAME, alternateName: HUB_ALT_NAME,
    applicationCategory: 'BusinessApplication', operatingSystem: 'Clover', inLanguage: ['fr-CA', 'en-CA'],
    description: hubTagline(lang), url: hubUrl(ctx.base, 'landing', lang), publisher: { '@id': orgId },
    featureList: hubBenefits(lang),
  };
  if (ctx.appMarketUrl) {
    const price = STANDARD_MONTHLY_CAD.toFixed(2);
    app.offers = {
      '@type': 'Offer', url: ctx.appMarketUrl, price, priceCurrency: PRICING.currency, availability: 'https://schema.org/InStock',
      eligibleRegion: { '@type': 'Country', name: PRICING.country }, description: PRICING_STATEMENT[lang],
      priceSpecification: { '@type': 'UnitPriceSpecification', price, priceCurrency: PRICING.currency, billingDuration: 'P1M', unitCode: 'MON' },
    };
  }

  const page: Record<string, unknown> = {
    '@type': 'WebPage', '@id': `${url}#webpage`, url, name: c.title, description: c.description, inLanguage: LOCALE[lang],
    isPartOf: { '@type': 'WebSite', '@id': `${ctx.base}/hub#website`, name: HUB_NAME, url: hubUrl(ctx.base, 'landing', 'fr'), publisher: { '@id': orgId } },
    about: { '@id': appId },
    primaryImageOfPage: `${ctx.base}${OG_IMAGE[lang]}`,
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
  if (c.faq.length) {
    graph.push({
      '@type': 'FAQPage', '@id': `${url}#faq`, inLanguage: LOCALE[lang],
      mainEntity: c.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
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

export function hubSitemap(base = publicBaseUrl()): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  for (const key of HUB_PAGE_KEYS) {
    const languages = { 'fr-CA': hubUrl(base, key, 'fr'), 'en-CA': hubUrl(base, key, 'en'), 'x-default': hubUrl(base, key, 'fr') };
    for (const lang of ['fr', 'en'] as const) out.push({ url: hubUrl(base, key, lang), alternates: { languages } });
  }
  for (const p of [LEGAL_PATHS.support, LEGAL_PATHS.privacy, LEGAL_PATHS.terms]) out.push({ url: `${base}${p}` });
  return out;
}

export function hubRobots(base = publicBaseUrl()) {
  return {
    rules: [{
      userAgent: '*',
      allow: ['/hub', '/en/hub', '/legal/', '/llms.txt', '/og/'],
      disallow: ['/api/', '/p/', '/courier', '/kitchen/', '/ticket/', '/media/', '/welcome/'],
    }],
    sitemap: `${base}/sitemap.xml`,
  };
}

/** Plain-text summary for AI assistants (llms.txt): French first, then English. Facts only. */
export function hubLlmsTxt(ctx: HubContext = hubContext()): string {
  const block = (lang: Lang) => {
    const fr = lang === 'fr';
    const market = ctx.appMarketUrl
      ? `${fr ? 'Disponible sur le Clover App Market' : 'Available on the Clover App Market'} : ${ctx.appMarketUrl}`
      : (fr ? 'Bientôt sur le Clover App Market (en révision chez Clover). Tarif prévu au lancement.' : 'Coming soon to the Clover App Market (under review by Clover). Planned launch pricing.');
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
      ...hubFeatures(lang).map((f) => `- ${f.title}: ${f.text}`),
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
      ...HUB_PAGE_KEYS.map((k) => `- [${HUB_CONTENT[k][lang].label}](${hubUrl(ctx.base, k, lang)})`),
      `- [${fr ? 'Soutien' : 'Support'}](${ctx.base}${LEGAL_PATHS.support})`,
      `- [${fr ? 'Confidentialité' : 'Privacy'}](${ctx.base}${LEGAL_PATHS.privacy})`,
      `- [${fr ? 'Conditions' : 'Terms'}](${ctx.base}${LEGAL_PATHS.terms})`,
    ];
    if (ctx.supportEmail) lines.push('', `${fr ? 'Contact' : 'Contact'}: ${ctx.supportEmail}`);
    return lines.join('\n');
  };
  return [`# ${HUB_NAME}`, '', block('fr'), '', block('en'), ''].join('\n');
}
