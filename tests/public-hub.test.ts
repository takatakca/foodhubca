import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HubPage } from '../components/public-hub/hub-page';
import { LISTING_BENEFITS } from '../lib/foodhub/clover-listing';
import {
  appMarketStatus, appMarketUrl, EXTRA_BRAND_PLATFORM_CAD, formatCad, formatCadLabel, livePlatforms, monthlyTotalCad, PHONE_MINUTE_CAD,
  PHONE_MONTHLY_CAD, PHONE_PRICING_STATEMENT, PHONE_TRIAL_DAYS, PRICING, PRICING_STATEMENT, STANDARD_MONTHLY_CAD, TRIAL_DAYS,
} from '../lib/foodhub/pricing';
import { CLOVER_APPS, liveCloverApps } from '../lib/foodhub/clover-apps';
import { PHONE_PRICE } from '../lib/foodhub/pos/clover-phone-minutes';
import * as cloverPricing from '../lib/foodhub/pos/clover-pricing';
import {
  HUB_CONTENT, HUB_PAGE_KEYS, HUB_PATHS, HUB_PRODUCTION_BASE, hubBase, hubMarketUrl, hubFaq, hubFeatures, hubIndexable, hubJsonLd, hubLlmsTxt, hubMetadata,
  hubPageAt, hubPageForSlug, hubRequirements, hubRobots, hubSitemap, hubTagline, jsonLdScript, postalAddress, publicSameAs, type HubContext,
} from '../lib/foodhub/public-hub';
import { LANG_COOKIE } from '../lib/i18n';
import { isIndexablePath, isPublicSitePath, isStorefrontIndexablePath, PUBLIC_LANG_HEADER, PUBLIC_PAGE_CACHE, publicHomeEnabled, publicSiteLang } from '../lib/foodhub/public-site';
import { DEVICE_COOKIE, ownerSessionVersion, SESSION_COOKIE, signDevice, signSession } from '../lib/foodhub/session';
import { proxy } from '../proxy';

const BASE = 'https://foodhub.on2go.ca';
const LANGS = ['fr', 'en'] as const;
const ctx = (over: Partial<HubContext> = {}): HubContext => ({
  base: BASE, appMarketUrl: null, sameAs: [], supportEmail: null, company: 'Quadro Holdings LTEE',
  address: '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada', marketStatus: 'review', livePlatforms: ['uber'], ...over,
});
const ALL_LIVE = ['uber', 'doordash', 'skip'] as HubContext['livePlatforms'];
/** Pages about a platform that has not approved the integration yet (default: only Uber Eats is live). */
const PENDING_KEYS = ['doordash', 'skip'];
const INDEXED_KEYS = HUB_PAGE_KEYS.filter((k) => !PENDING_KEYS.includes(k));
const render = (page: (typeof HUB_PAGE_KEYS)[number], lang: 'fr' | 'en', c = ctx()) => renderToStaticMarkup(createElement(HubPage, { page, lang, ctx: c }));
const ldOf = (html: string) => {
  const m = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  return JSON.parse(m![1]) as { '@graph': Array<Record<string, unknown>> };
};
const node = (ld: { '@graph': Array<Record<string, unknown>> }, type: string) => ld['@graph'].find((n) => n['@type'] === type);
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

/** Banned on every public page: hours claims, "virtual / ghost / dark kitchen", aggregator names. */
const BANNED = [/24\s?\/\s?7/i, /\b24\s?h\b/i, /\b24\s?heures\b/i, /\b24\s?hours\b/i, /virtuel/i, /\bvirtual\b/i, /\bghost\b/i, /dark kitchen/i, /cuisine fantôme/i,
  /deliverect/i, /\botter\b/i, /cuboh/i, /checkmate/i, /urbanpiper/i, /chowly/i];
const banned = (text: string) => BANNED.filter((r) => r.test(text)).map(String);

/** Too Good To Go is only ever named with its condition: right before « lorsque » / "when", or as the starred chip
 * whose footnote says it. Returns the offending snippets. */
const unconditionalTgtg = (text: string) => [...text.matchAll(/Too Good To Go(?!\*|\s?:?\s?(?:lorsque|when)\b)/g)].map((m) => text.slice(Math.max(0, m.index! - 40), m.index! + 60));

describe('public site paths (lib/foodhub/public-site.ts)', () => {
  it('opens /hub, /en/hub, robots, sitemap, llms.txt, share images and the favicon — and nothing that merely looks alike', () => {
    for (const p of ['/hub', '/hub/tarifs', '/hub/integrations/uber-eats-clover', '/en/hub', '/en/hub/pricing', '/robots.txt', '/sitemap.xml', '/llms.txt', '/favicon.ico', '/og/hub-fr.png']) {
      expect(isPublicSitePath(p), p).toBe(true);
    }
    for (const p of ['/hubx', '/hub-admin', '/en/hubx', '/en', '/', '/orders', '/robots.txt/x', '/llms.txtx', '/sitemap.xml.bak', '/ogx']) {
      expect(isPublicSitePath(p), p).toBe(false);
    }
    expect(publicSiteLang('/hub/tarifs')).toBe('fr');
    expect(publicSiteLang('/en/hub/pricing')).toBe('en');
    expect(publicSiteLang('/robots.txt')).toBeNull();
    expect(isIndexablePath('/legal/terms')).toBe(true);
    expect(isIndexablePath('/icons/icon-512.png')).toBe(true); // the Organization logo must be indexable
    expect(isIndexablePath('/media/abc123.jpg')).toBe(true); // dish photos shown on on2go.ca stay eligible for image search
    expect(isIndexablePath('/login')).toBe(false);
    // The ON2GO storefront ordering pages (#75) stay indexable; their order-tracking pages and QR images do not.
    expect(isIndexablePath('/commander/pizzeria-ndg')).toBe(true);
    expect(isIndexablePath('/commander/sitemap.xml')).toBe(true);
    expect(isStorefrontIndexablePath('/commander/pizzeria-ndg/suivi/tok123')).toBe(false);
    expect(isIndexablePath('/commander/pizzeria-ndg/suivi/tok123')).toBe(false);
    expect(isIndexablePath('/commander/pizzeria-ndg/qr.svg')).toBe(false);
    expect(isIndexablePath('/commanderx')).toBe(false);
  });
  it('FOODHUB_PUBLIC_HOME is on unless set to off', () => {
    expect(publicHomeEnabled(undefined)).toBe(true);
    expect(publicHomeEnabled('')).toBe(true);
    expect(publicHomeEnabled('on')).toBe(true);
    for (const v of ['off', 'OFF', 'false', '0', 'no']) expect(publicHomeEnabled(v), v).toBe(false);
  });
});

describe('proxy.ts with a sign-in configured', () => {
  beforeEach(() => { process.env.DASHBOARD_PASSWORD = 'Owner-pass-123'; delete process.env.SESSION_SECRET; delete process.env.FOODHUB_PUBLIC_HOME; });
  afterEach(() => { delete process.env.DASHBOARD_PASSWORD; delete process.env.FOODHUB_PUBLIC_HOME; });
  const get = (path: string, headers: Record<string, string> = {}) => proxy(new NextRequest(`http://hub.local${path}`, { headers }));

  it('lets the public pages through without a session, with their language fixed by the path', async () => {
    for (const [path, lang] of [['/hub', 'fr'], ['/hub/tarifs', 'fr'], ['/en/hub', 'en'], ['/en/hub/integrations/doordash-clover', 'en']] as const) {
      const res = await get(path, { cookie: `${LANG_COOKIE}=${lang === 'fr' ? 'en' : 'fr'}` }); // a cookie that disagrees with the path
      expect(res.headers.get('x-middleware-next'), path).toBe('1');
      expect(res.headers.get(`x-middleware-request-${PUBLIC_LANG_HEADER}`), path).toBe(lang);
      expect(res.headers.get('x-robots-tag'), path).toBeNull();
      expect(res.headers.get('cache-control'), path).toBe(PUBLIC_PAGE_CACHE); // same HTML for everyone: cacheable
    }
    for (const path of ['/robots.txt', '/sitemap.xml', '/llms.txt', '/og/hub-fr.png', '/icons/icon-512.png', '/icons/icon-192.png', '/icons/apple-touch-icon.png', '/media/abc123.jpg']) {
      const res = await get(path);
      expect(res.headers.get('x-middleware-next'), path).toBe('1');
      expect(res.headers.get('x-robots-tag'), path).toBeNull();
    }
  });
  it('keeps look-alikes and the API private', async () => {
    for (const path of ['/hubx', '/hub-admin', '/en/hubx']) {
      const res = await get(path);
      expect(res.status, path).toBe(307);
      expect(res.headers.get('location'), path).toContain('/login?next=');
      expect(res.headers.get('x-robots-tag'), path).toBe('noindex');
    }
    const api = await get('/api/foodhub/command');
    expect(api.status).toBe(401);
    expect(api.headers.get('x-robots-tag')).toBe('noindex');
  });
  it('sends an anonymous visitor on "/" to /hub; FOODHUB_PUBLIC_HOME=off restores /login', async () => {
    const res = await get('/');
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get('location')!).pathname).toBe('/hub');
    process.env.FOODHUB_PUBLIC_HOME = 'off';
    const off = await get('/');
    expect(off.status).toBe(307);
    expect(new URL(off.headers.get('location')!).pathname).toBe('/login');
  });
  it('"/" with a tracking query lands on /hub with the query kept; a tablet or a session keeps the old behaviour', async () => {
    for (const query of ['?fbclid=abc123', '?utm_source=linkedin&utm_medium=social']) {
      const q = await get(`/${query}`);
      expect(q.status, query).toBe(307); // temporary: a cached permanent redirect would hide the owner's console on "/"
      const to = new URL(q.headers.get('location')!);
      expect(to.pathname, query).toBe('/hub');
      expect(to.search, query).toBe(query);
    }
    const device = await signDevice({ d: 'tab-1', l: 'NDG_MAIN', exp: Math.floor(Date.now() / 1000) + 60 });
    const tablet = await get('/', { cookie: `${DEVICE_COOKIE}=${encodeURIComponent(device!)}` });
    expect(new URL(tablet.headers.get('location')!).pathname).toBe('/kitchen/lock');
    const owner = await signSession({ u: 'owner', n: 'Owner', r: 'owner', l: [], exp: Math.floor(Date.now() / 1000) + 60, b: true, v: ownerSessionVersion() });
    const signedIn = await get('/', { cookie: `${SESSION_COOKIE}=${encodeURIComponent(owner!)}` });
    expect(signedIn.headers.get('x-middleware-next')).toBe('1');
    expect(signedIn.headers.get('x-robots-tag')).toBe('noindex'); // the console is never indexed
  });
  it('marks /login and the other public endpoints noindex, never the legal pages or the storefront ordering pages', async () => {
    expect((await get('/login')).headers.get('x-robots-tag')).toBe('noindex');
    expect((await get('/api/public/directory')).headers.get('x-robots-tag')).toBe('noindex');
    expect((await get('/legal/terms')).headers.get('x-robots-tag')).toBeNull();
    const storefront = await get('/commander/pizzeria-ndg');
    expect(storefront.headers.get('x-middleware-next')).toBe('1'); // public without a session (#75)
    expect(storefront.headers.get('x-robots-tag')).toBeNull();
    expect((await get('/commander/sitemap.xml')).headers.get('x-robots-tag')).toBeNull();
    expect((await get('/commander/pizzeria-ndg/suivi/tok123')).headers.get('x-robots-tag')).toBe('noindex');
  });
});

describe('pricing (lib/foodhub/pricing.ts)', () => {
  it('holds the owner’s numbers once (Food Hub from clover-pricing.ts, phone equal to the metering price)', () => {
    expect(PRICING).toEqual({ trialDays: 14, monthlyPerApp: 50, extraBrandPerPlatform: 15, phonePerMinute: 0.25, currency: 'CAD', country: 'CA' });
    expect([TRIAL_DAYS, STANDARD_MONTHLY_CAD, EXTRA_BRAND_PLATFORM_CAD]).toEqual([cloverPricing.TRIAL_DAYS, cloverPricing.STANDARD_MONTHLY_CAD, cloverPricing.EXTRA_BRAND_PLATFORM_CAD]);
    expect({ monthlyCad: PHONE_MONTHLY_CAD, perMinuteCad: PHONE_MINUTE_CAD, trialDays: PHONE_TRIAL_DAYS }).toEqual(PHONE_PRICE);
    expect(monthlyTotalCad(3)).toBe(95);
    expect(formatCad(50, 'fr')).toBe('50 $');
    expect(formatCad(15, 'en')).toBe('$15');
    expect(formatCadLabel(50, 'fr')).toBe('50 $ CA');
    expect(formatCadLabel(0.25, 'fr')).toBe('0,25 $ CA');
    expect(formatCadLabel(0.25, 'en')).toBe('CAD $0.25');
  });
  it('states the submitted-app pricing (owner, 2026-10-17): 14-day free trial, then CAD $50/month per app', () => {
    expect(PRICING_STATEMENT.en).toBe('14-day free trial, then CAD $50/month per app. TAKATAK Food Hub: extra brand CAD $15 per platform per month. TAKATAK Phone AI: + CAD $0.25 per AI minute. Plus applicable taxes, billed by Clover.');
    expect(PRICING_STATEMENT.fr).toBe('Essai gratuit de 14 jours, puis 50 $ CA/mois par application. TAKATAK Food Hub : 15 $ CA par plateforme par mois pour chaque marque supplémentaire. TAKATAK Phone AI : + 0,25 $ CA par minute d’IA. Taxes en sus. Facturé par Clover.');
    expect(PHONE_PRICING_STATEMENT.en).toBe('14-day free trial, then CAD $50/month, + CAD $0.25 per AI minute. Plus applicable taxes, billed by Clover.');
    for (const t of [PRICING_STATEMENT.fr, PRICING_STATEMENT.en, PHONE_PRICING_STATEMENT.fr, PHONE_PRICING_STATEMENT.en]) {
      expect(t).not.toMatch(/prévu|planned|bientôt|coming soon/i);
    }
  });
  it('accepts only an https clover.com address for the App Market', () => {
    expect(appMarketUrl('')).toBeNull();
    expect(appMarketUrl('http://www.clover.com/appmarket/apps/X')).toBeNull();
    expect(appMarketUrl('https://clover.com.evil.example/x')).toBeNull();
    expect(appMarketUrl('https://evilclover.com/x')).toBeNull();
    expect(appMarketUrl('javascript:alert(1)')).toBeNull();
    expect(appMarketUrl(' https://www.clover.com/appmarket/apps/ABC123 ')).toBe('https://www.clover.com/appmarket/apps/ABC123');
  });
  it('keeps only https profile links for sameAs', () => {
    expect(publicSameAs('https://www.linkedin.com/company/on2go-hub, http://x.example, nope, https://www.linkedin.com/company/on2go-hub')).toEqual(['https://www.linkedin.com/company/on2go-hub']);
  });
});

describe('page routes', () => {
  it('maps every path both ways and refuses unknown slugs', () => {
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) expect(hubPageAt(HUB_PATHS[key][lang])).toEqual({ key, lang });
    expect(hubPageForSlug('fr', undefined)).toBe('landing');
    expect(hubPageForSlug('fr', ['tarifs'])).toBe('pricing');
    expect(hubPageForSlug('en', ['pricing'])).toBe('pricing');
    expect(hubPageForSlug('fr', ['pricing'])).toBeNull(); // the English slug under /hub is a 404, not a duplicate
    expect(hubPageForSlug('en', ['integrations'])).toBeNull();
    expect(hubPageForSlug('en', ['clover-kitchen-display'])).toBe('kitchen');
  });
});

describe('metadata', () => {
  it('every page has a unique title ≤ 60, a unique description of 70–155, canonical and hreflang', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) {
      const c = HUB_CONTENT[key][lang];
      expect(c.title.length, c.title).toBeLessThanOrEqual(60);
      expect(c.title, c.title).toMatch(/ON2GO.ca/);
      expect(c.description.length, c.description).toBeLessThanOrEqual(155);
      expect(c.description.length, c.description).toBeGreaterThanOrEqual(70);
      titles.add(c.title); descriptions.add(c.description);
      const m = hubMetadata(key, lang, { base: BASE });
      expect(m.alternates?.canonical).toBe(`${BASE}${HUB_PATHS[key][lang]}`);
      expect(m.alternates?.languages).toEqual({ 'fr-CA': `${BASE}${HUB_PATHS[key].fr}`, 'en-CA': `${BASE}${HUB_PATHS[key].en}`, 'x-default': `${BASE}${HUB_PATHS[key].fr}` });
      expect((m.twitter as { card?: string }).card).toBe('summary_large_image');
      expect(JSON.stringify(m.openGraph)).toContain(`${BASE}/og/hub-${lang}.png`);
      expect(m.robots, `${key}/${lang}`).toEqual({ index: !PENDING_KEYS.includes(key), follow: true });
      expect(hubMetadata(key, lang, { base: BASE, livePlatforms: ALL_LIVE }).robots).toEqual({ index: true, follow: true });
      const alt = (m.openGraph as { images: Array<{ alt: string }> }).images[0].alt;
      expect(alt).toBe(`ON2GO.ca${lang === 'fr' ? ' : ' : ': '}${c.label}`);
    }
    expect(titles.size).toBe(HUB_PAGE_KEYS.length * 2);
    expect(descriptions.size).toBe(HUB_PAGE_KEYS.length * 2);
  });
});

describe('page content', () => {
  it('renders one H1, the FAQ, the legal links and no banned words, in both languages (no page-specific client component or tracker)', () => {
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) {
      const html = render(key, lang);
      expect(html.match(/<h1[\s>]/g)?.length, `${key}/${lang}`).toBe(1);
      expect(html).toContain(`lang="${lang === 'fr' ? 'fr-CA' : 'en-CA'}"`);
      const text = visibleText(html);
      for (const f of hubFaq(key, lang, ctx())) { expect(text, f.q).toContain(f.q); expect(text, f.q).toContain(f.a); }
      expect(html).toContain('href="/legal/privacy"');
      expect(html).toContain('href="/legal/terms"');
      expect(html).toContain(`href="${HUB_PATHS[key][lang === 'fr' ? 'en' : 'fr']}"`); // the language twin
      expect(banned(text), `${key}/${lang}`).toEqual([]);
      expect(banned(JSON.stringify(HUB_CONTENT[key][lang])), `${key}/${lang} content`).toEqual([]);
      expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/); // no page-specific client component or tracker
      expect(html, `${key}/${lang} tokens`).not.toMatch(/\{(company|planned|pending|platforms?)\}/);
    }
  });
  it('the landing reuses the App Market listing (benefits, features, requirements) and says Too Good To Go only with its condition', () => {
    const fr = visibleText(render('landing', 'fr'));
    for (const b of LISTING_BENEFITS) expect(fr).toContain(b.fr);
    for (const f of hubFeatures('fr')) expect(fr).toContain(f.title);
    expect(hubFeatures('fr').length).toBeGreaterThanOrEqual(6);
    expect(hubRequirements('fr')).toMatch(/^Un forfait Clover/);
    expect(hubRequirements('en')).toMatch(/^A Clover plan/);
    expect(hubRequirements('en')).toContain('ON2GO.ca account');
    expect(JSON.stringify(HUB_CONTENT)).not.toMatch(/ON2GO Hub/); // the hub is "ON2GO.ca" (owner, 2026-10-17)
    expect(fr).toContain('Too Good To Go : lorsque votre compte offre un flux de commandes');
    expect(visibleText(render('landing', 'en'))).toContain('Too Good To Go: when your account offers an order feed');
  });
  it('never names Too Good To Go without its condition: page text, JSON-LD, metadata, tagline and llms.txt', () => {
    for (const lang of LANGS) expect(hubTagline(lang)).not.toContain('Too Good To Go');
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) {
      const html = render(key, lang);
      expect(unconditionalTgtg(visibleText(html)), `${key}/${lang} text`).toEqual([]);
      expect(unconditionalTgtg(JSON.stringify(ldOf(html))), `${key}/${lang} JSON-LD`).toEqual([]);
      expect(unconditionalTgtg(JSON.stringify(hubMetadata(key, lang, { base: BASE }))), `${key}/${lang} metadata`).toEqual([]);
    }
    expect(unconditionalTgtg(hubLlmsTxt(ctx(), true))).toEqual([]);
    expect(unconditionalTgtg('Uber Eats et Too Good To Go dans Clover')).toHaveLength(1); // the check itself works
  });
  it('each FAQ question appears on one page only (no repeated FAQPage markup); the price question lives on the pricing page', () => {
    for (const lang of LANGS) {
      const seen = new Map<string, string>();
      for (const key of HUB_PAGE_KEYS) for (const f of HUB_CONTENT[key][lang].faq) {
        expect(seen.get(f.q), `${lang}: "${f.q}" on ${seen.get(f.q)} and ${key}`).toBeUndefined();
        seen.set(f.q, key);
      }
      expect(seen.get(lang === 'fr' ? 'Combien coûte ON2GO.ca ?' : 'How much does ON2GO.ca cost?')).toBe('pricing');
    }
  });
  it('the nav "Integrations" link goes to the landing’s integrations block, which exists', () => {
    for (const lang of LANGS) {
      expect(render('kitchen', lang)).toContain(`href="${HUB_PATHS.landing[lang]}#integrations"`);
      expect(render('landing', lang)).toContain('id="integrations"');
    }
  });
  it('the legal name comes from the context, not the words', () => {
    const fr = visibleText(render('landing', 'fr', ctx({ company: 'Société Test inc.' })));
    expect(fr).toContain('conçu à Montréal par Société Test inc.');
    expect(JSON.stringify(HUB_CONTENT)).not.toContain('Quadro');
  });
  it('the AI phone is TAKATAK Phone AI, a separate Clover app: automated assistant, press 0, its own price', () => {
    for (const lang of LANGS) {
      const text = visibleText(render('phone', lang));
      expect(text).not.toMatch(/répond à chaque appel|answers every call|Plus d’appel manqué|no more missed calls/i);
      expect(text).not.toMatch(/bientôt|coming soon|prévu|planned|en préparation|in the works/i);
      expect(text).toContain('TAKATAK Phone AI');
      expect(text).toContain(lang === 'fr' ? 'faire le 0 pour parler à une personne' : 'press 0 to speak with a person');
      expect(text).toContain(lang === 'fr' ? 'assistant automatisé' : 'automated assistant');
      expect(text).toContain(lang === 'fr' ? '0,25 $ CA par minute d’IA' : 'CAD $0.25 per AI minute');
      expect(text).toContain(lang === 'fr' ? 'Essai gratuit de 14 jours, puis 50 $ CA par mois' : '14-day free trial, then CAD $50 a month');
    }
    expect(visibleText(render('landing', 'fr'))).toContain('Téléphone IA : TAKATAK Phone AI');
  });
  it('prices come from pricing.ts and never say "planned"; the App Market link turns the badge into "available"', () => {
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) {
      const text = visibleText(render(key, lang));
      expect(text, `${key}/${lang}`).not.toMatch(/tarif prévu|planned launch|planned pricing/i);
    }
    const fr = visibleText(render('pricing', 'fr'));
    expect(fr).toContain(formatCadLabel(STANDARD_MONTHLY_CAD, 'fr'));
    expect(fr).toContain(`+${formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, 'fr')}`);
    expect(fr).toContain(String(TRIAL_DAYS));
    expect(fr).toContain(`TAKATAK Phone AI : ${PHONE_PRICING_STATEMENT.fr}`);
    expect(fr).toContain('Soumise au Clover App Market : en révision');
    expect(fr).not.toContain('Disponible sur le Clover App Market');
    const price = hubFaq('pricing', 'fr', ctx()).find((f) => f.q === 'Combien coûte ON2GO.ca ?')!;
    expect(price.a).toContain(`Essai gratuit de ${TRIAL_DAYS} jours, puis 50 $ CA par mois par application.`);
    expect(price.a).toContain(formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, 'fr'));
    expect(fr).toContain(formatCadLabel(monthlyTotalCad(3), 'fr'));
    expect(fr).toContain(formatCadLabel(monthlyTotalCad(1), 'fr'));
    const en = visibleText(render('pricing', 'en'));
    expect(en).toContain(`TAKATAK Phone AI : ${PHONE_PRICING_STATEMENT.en}`); // visibleText() puts a space after </b>
    expect(hubFaq('pricing', 'en', ctx())[0].a).toContain('14-day free trial, then CAD $50 a month per app.');
    const url = 'https://www.clover.com/appmarket/apps/ABC123';
    const live = render('pricing', 'en', ctx({ appMarketUrl: url, marketStatus: 'live' }));
    expect(visibleText(live)).toContain('Available on the Clover App Market');
    expect(live).toContain(`href="${url}"`);
    // The Stop answer uses the legal pages' token wording (no "at once" promise).
    expect(en).toContain('your Clover access tokens are deleted when Clover notifies us that the app was uninstalled, or on request');
    expect(en).not.toMatch(/deleted at once|supprimés aussitôt/);
  });
  it('says "under review" by default (both apps submitted on 2026-10-17); "coming soon" only with FOODHUB_APP_MARKET_STATUS=soon', () => {
    expect(appMarketStatus(null, undefined)).toBe('review');
    expect(appMarketStatus(null, '')).toBe('review');
    expect(appMarketStatus(null, ' Soon ')).toBe('soon');
    expect(appMarketStatus('https://www.clover.com/appmarket/apps/ABC123', 'soon')).toBe('live');
    expect(visibleText(render('pricing', 'fr'))).toContain('Les deux applications sont soumises au Clover App Market et en révision chez Clover.');
    expect(visibleText(render('pricing', 'en'))).toContain('Both apps are submitted to the Clover App Market and under review by Clover.');
    expect(visibleText(render('landing', 'en'))).toContain('Submitted to the Clover App Market: under review');
    expect(visibleText(render('pricing', 'fr', ctx({ marketStatus: 'soon' })))).toContain('Les applications seront bientôt offertes sur le Clover App Market.');
    expect(hubLlmsTxt(ctx())).toContain('Both apps are submitted to the Clover App Market and under review by Clover.');
    expect(hubLlmsTxt(ctx({ marketStatus: 'soon' }))).not.toMatch(/en révision|under review/i);
  });
  it('the App Market link and the badges follow NEXT_PUBLIC_CLOVER_APPS_LIVE (#78) unless FOODHUB_APP_MARKET_URL is set', () => {
    expect(hubMarketUrl([], '')).toBeNull();
    const foodhub = CLOVER_APPS.find((a) => a.key === 'foodhub')!;
    expect(hubMarketUrl(liveCloverApps('foodhub,phone'), '')).toBe(`https://www.clover.com/appmarket/apps/${foodhub.appId}`);
    expect(hubMarketUrl(liveCloverApps('phone'), '')).toBeNull(); // the phone app alone does not make Food Hub live
    expect(hubMarketUrl(liveCloverApps('foodhub'), 'https://www.clover.com/appmarket/apps/OWN')).toBe('https://www.clover.com/appmarket/apps/OWN');
    expect(render('landing', 'fr')).not.toContain('data-clover-badges');
    const withBadges = render('pricing', 'fr', ctx({ cloverApps: liveCloverApps('foodhub,phone') }));
    expect(withBadges).toContain('data-clover-badges="block"');
    expect(withBadges).toContain('data-clover-badges="compact"');
    expect(withBadges).toContain('apps/20FK28P20HJC6');
    expect(withBadges).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });
  it('DoorDash and SkipTheDishes show « in certification » until FOODHUB_PUBLIC_LIVE_PLATFORMS lists them', () => {
    expect(livePlatforms(undefined)).toEqual(['uber']);
    expect(livePlatforms('uber, doordash')).toEqual(['uber', 'doordash']);
    expect(livePlatforms('skip,nope')).toEqual(['skip']);
    expect(hubIndexable('doordash', ctx())).toBe(false);
    expect(hubIndexable('uber', ctx())).toBe(true);
    expect(hubIndexable('landing', ctx())).toBe(true);
    expect(visibleText(render('doordash', 'fr'))).toContain('Intégration en cours de certification avec DoorDash.');
    expect(visibleText(render('skip', 'en'))).toContain('SkipTheDishes integration in certification.');
    expect(visibleText(render('uber', 'fr'))).not.toContain('Intégration en cours de certification avec Uber'); // live: no note (its links to pending pages carry a badge)
    const landing = visibleText(render('landing', 'fr'));
    expect(landing).toContain('L’intégration avec DoorDash et SkipTheDishes est en cours de certification.');
    expect(landing).toContain('En certification'); // badge on the links to the two pending pages
    const faq = hubFaq('landing', 'en', ctx()).find((f) => f.q === 'Which platforms are supported?')!;
    expect(faq.a).toContain('The DoorDash and SkipTheDishes integration is in certification.');
    const allLive = visibleText(render('landing', 'fr', ctx({ livePlatforms: ALL_LIVE })));
    expect(allLive).not.toContain('certification');
    expect(visibleText(render('doordash', 'fr', ctx({ livePlatforms: ALL_LIVE })))).not.toContain('certification');
  });
  it('kitchen copy claims red on screen only (a thermal ticket prints no red); French uses « application » and « heures de pointe »', () => {
    expect(visibleText(render('kitchen', 'fr'))).toContain('ressortent en rouge à l’écran et sont imprimées sur le billet');
    expect(visibleText(render('kitchen', 'en'))).toContain('stand out in red on screen and are printed on the ticket');
    for (const key of HUB_PAGE_KEYS) {
      const fr = visibleText(render(key, 'fr')) + JSON.stringify(HUB_CONTENT[key].fr);
      expect(fr, key).not.toMatch(/\bpar app\b|une seule app\b|\brush\b|sur l’écran comme sur le billet/i);
    }
    expect(visibleText(render('pricing', 'en'))).toContain('days of free trial');
    expect(PRICING_STATEMENT.fr).toContain('15 $ CA par plateforme par mois pour chaque marque supplémentaire');
    expect(PRICING_STATEMENT.fr).toContain('Taxes en sus');
    expect(PRICING_STATEMENT.en).toContain('extra brand CAD $15 per platform per month');
    expect(PRICING_STATEMENT.en).toContain('Plus applicable taxes');
  });
  it('shows the support email only when it is set', () => {
    expect(render('landing', 'fr')).not.toContain('mailto:');
    expect(render('landing', 'fr', ctx({ supportEmail: 'support@example.com' }))).toContain('mailto:support@example.com');
  });
});

describe('structured data', () => {
  it('Organization, SoftwareApplication, WebPage and a FAQPage equal to the visible FAQ; breadcrumbs on sub-pages; never a rating', () => {
    for (const key of HUB_PAGE_KEYS) for (const lang of LANGS) {
      const html = render(key, lang);
      const ld = ldOf(html);
      expect(ld['@graph'].map((n) => n['@type'])).toEqual(expect.arrayContaining(['Organization', 'SoftwareApplication', 'WebPage', 'FAQPage']));
      const org = node(ld, 'Organization')!;
      expect(org).toMatchObject({ name: 'ON2GO.ca', alternateName: ['TAKATAK Food Hub'], legalName: 'Quadro Holdings LTEE' });
      expect(org.address).toEqual({ '@type': 'PostalAddress', streetAddress: '6280, av. Somerled', addressLocality: 'Montréal', addressRegion: 'QC', postalCode: 'H3X 2B6', addressCountry: 'CA' });
      expect(org.email).toBeUndefined();
      expect(org.sameAs).toBeUndefined();
      const app = node(ld, 'SoftwareApplication')!;
      expect(app).toMatchObject({ name: 'ON2GO.ca', alternateName: 'TAKATAK Food Hub', applicationCategory: 'BusinessApplication', operatingSystem: 'Clover' });
      expect(app.offers).toBeUndefined();
      const faq = node(ld, 'FAQPage')! as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> };
      expect(faq.mainEntity.map((q) => q.name)).toEqual(hubFaq(key, lang, ctx()).map((f) => f.q));
      // One entity, one url: the shared nodes point at the French landing on every page; the WebPage has its own url.
      expect(org.url, `${key}/${lang}`).toBe(`${BASE}/hub`);
      expect(app.url, `${key}/${lang}`).toBe(`${BASE}/hub`);
      expect(node(ld, 'WebPage')!.url).toBe(`${BASE}${HUB_PATHS[key][lang]}`);
      expect(app.description).toBe(hubTagline(lang));
      const text = visibleText(html);
      for (const q of faq.mainEntity) expect(text).toContain(q.acceptedAnswer.text);
      expect(Boolean(node(ld, 'BreadcrumbList'))).toBe(key !== 'landing');
      expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|reviewRating|"review"/);
    }
  });
  it('publishes the Offer only with the App Market link, and sameAs / email when configured', () => {
    const url = 'https://www.clover.com/appmarket/apps/ABC123';
    const ld = hubJsonLd('landing', 'fr', ctx({ appMarketUrl: url, sameAs: ['https://www.linkedin.com/company/on2go-hub'], supportEmail: 'support@example.com' }));
    const graph = ld['@graph'] as Array<Record<string, unknown>>;
    const app = graph.find((n) => n['@type'] === 'SoftwareApplication')!;
    expect(app.offers).toMatchObject({ '@type': 'Offer', url, price: '50.00', priceCurrency: 'CAD', priceSpecification: { billingDuration: 'P1M', price: '50.00' } });
    expect((app.offers as Record<string, unknown>).eligibleRegion).toEqual({ '@type': 'Country', name: 'Canada', identifier: 'CA' });
    const page = graph.find((n) => n['@type'] === 'WebPage')!;
    expect(page.primaryImageOfPage).toEqual({ '@type': 'ImageObject', url: `${BASE}/og/hub-fr.png`, width: 1200, height: 630 });
    const org = graph.find((n) => n['@type'] === 'Organization')!;
    expect(org.sameAs).toEqual(['https://www.linkedin.com/company/on2go-hub']);
    expect(org.email).toBe('support@example.com');
  });
  it('in production, a base that is not https falls back to the real address (never localhost in canonicals or the sitemap)', () => {
    expect(hubBase('http://localhost:3000', 'production')).toBe(HUB_PRODUCTION_BASE);
    expect(hubBase('foodhub.on2go.ca', 'production')).toBe(HUB_PRODUCTION_BASE);
    expect(hubBase('https://foodhub.on2go.ca', 'production')).toBe('https://foodhub.on2go.ca');
    expect(hubBase('https://staging.example.com', 'production')).toBe('https://staging.example.com');
    expect(hubBase('http://localhost:3000', 'development')).toBe('http://localhost:3000');
  });
  it('escapes the script content and parses addresses safely', () => {
    expect(jsonLdScript({ a: '</script><b>&' })).toBe('{"a":"\\u003c/script\\u003e\\u003cb\\u003e\\u0026"}');
    expect(postalAddress('somewhere else')).toEqual({ '@type': 'PostalAddress', streetAddress: 'somewhere else', addressCountry: 'CA' });
  });
});

describe('robots.txt, sitemap.xml and llms.txt', () => {
  beforeEach(() => { process.env.FOODHUB_PUBLIC_URL = BASE; delete process.env.FOODHUB_APP_MARKET_URL; delete process.env.FOODHUB_APP_MARKET_STATUS; delete process.env.FOODHUB_PUBLIC_LIVE_PLATFORMS; });
  afterEach(() => { delete process.env.FOODHUB_PUBLIC_URL; delete process.env.FOODHUB_APP_MARKET_URL; delete process.env.FOODHUB_APP_MARKET_STATUS; delete process.env.FOODHUB_PUBLIC_LIVE_PLATFORMS; });

  it('robots allows the public pages and blocks only the API: private pages stay fetchable so their noindex is seen', async () => {
    const robots = (await import('../app/robots')).default();
    const rule = (Array.isArray(robots.rules) ? robots.rules[0] : robots.rules)!;
    expect(rule.allow).toEqual(expect.arrayContaining(['/hub', '/en/hub', '/legal/', '/commander/', '/llms.txt', '/icons/']));
    expect(rule.disallow).toEqual(['/api/']);
    expect(JSON.stringify(hubRobots(BASE))).not.toMatch(/\/p\/|\/ticket\/|\/welcome\/|\/media\/|\/login/);
    expect(robots.sitemap).toEqual([`${BASE}/sitemap.xml`, `${BASE}/commander/sitemap.xml`]); // + the storefront's own sitemap (#75)
  });
  it('the sitemap lists every live hub page in both languages with language links; legal pages and pending platforms wait', async () => {
    delete process.env.FOODHUB_LEGAL_APPROVED;
    const map = (await import('../app/sitemap')).default();
    expect(map.length).toBe(INDEXED_KEYS.length * 2);
    expect(map.some((e) => /doordash|skipthedishes/.test(e.url))).toBe(false); // integrations in certification are not promoted
    process.env.FOODHUB_PUBLIC_LIVE_PLATFORMS = 'uber,doordash,skip';
    try {
      expect((await import('../app/sitemap')).default().length).toBe(HUB_PAGE_KEYS.length * 2);
    } finally { delete process.env.FOODHUB_PUBLIC_LIVE_PLATFORMS; }
    expect(map.some((e) => e.url.includes('/legal/'))).toBe(false); // the draft (banner on) is not promoted
    expect(map.map((e) => e.url)).toEqual(expect.arrayContaining([`${BASE}/hub`, `${BASE}/en/hub/pricing`]));
    process.env.FOODHUB_LEGAL_APPROVED = 'true';
    try {
      const approved = (await import('../app/sitemap')).default();
      expect(approved.length).toBe(INDEXED_KEYS.length * 2 + 3);
      expect(approved.map((e) => e.url)).toEqual(expect.arrayContaining([`${BASE}/legal/privacy`, `${BASE}/legal/terms`, `${BASE}/legal/support`]));
    } finally { delete process.env.FOODHUB_LEGAL_APPROVED; }
    expect(hubSitemap(BASE, false).length).toBe(INDEXED_KEYS.length * 2);
    expect(hubSitemap(BASE, true).length).toBe(INDEXED_KEYS.length * 2 + 3);
    expect(hubSitemap(BASE, true, ALL_LIVE).length).toBe(HUB_PAGE_KEYS.length * 2 + 3);
    expect(map.find((e) => e.url === `${BASE}/hub/tarifs`)?.alternates?.languages).toMatchObject({ 'en-CA': `${BASE}/en/hub/pricing` });
    expect(map.every((e) => !('lastModified' in e))).toBe(true);
    expect(hubSitemap(BASE).every((e) => !e.url.includes('/login'))).toBe(true);
  });
  it('the draft legal pages are noindex (links still followed) until FOODHUB_LEGAL_APPROVED=true', async () => {
    const { generateMetadata } = await import('../app/legal/layout');
    delete process.env.FOODHUB_LEGAL_APPROVED;
    expect(generateMetadata()).toEqual({ robots: { index: false, follow: true } });
    process.env.FOODHUB_LEGAL_APPROVED = 'true';
    try {
      expect(generateMetadata()).toEqual({});
    } finally { delete process.env.FOODHUB_LEGAL_APPROVED; }
  });
  it('llms.txt is plain text, French first, with the facts and no banned words', async () => {
    const res = (await import('../app/llms.txt/route')).GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    const text = await res.text();
    expect(text.indexOf('## Français')).toBeLessThan(text.indexOf('## English'));
    expect(text).toContain(PRICING_STATEMENT.fr);
    expect(text).toContain(PRICING_STATEMENT.en);
    expect(text).toContain('Les deux applications sont soumises au Clover App Market et en révision chez Clover.');
    expect(text).not.toMatch(/prévu|planned|bientôt|coming soon/i);
    expect(text).toContain(`TAKATAK Phone AI (téléphone IA) : application Clover distincte`);
    expect(text).toContain(PHONE_PRICING_STATEMENT.en);
    expect(text).not.toContain('/integrations/doordash-clover'); // pending integrations are not promoted
    expect(text).toContain('L’intégration avec DoorDash et SkipTheDishes est en cours de certification.');
    expect(text).toContain(`${BASE}/hub/tarifs`);
    expect(text).toContain('TAKATAK Food Hub');
    expect(text).toContain('# ON2GO.ca');
    expect(text).not.toMatch(/@[a-z0-9-]+\.[a-z]/i); // no email unless FOODHUB_SUPPORT_EMAIL is set
    expect(hubLlmsTxt(ctx({ supportEmail: 'support@example.com' }))).toContain('Contact : support@example.com');
    expect(banned(text)).toEqual([]);
    expect(text).toMatch(/^- Commandes : /m); // French typography: " : "
    expect(text).toMatch(/^- Orders: /m);
    expect(text).not.toContain('/legal/'); // the legal pages wait for their approval
    expect(hubLlmsTxt(ctx(), true)).toContain(`${BASE}/legal/terms`);
    const live = hubLlmsTxt(ctx({ appMarketUrl: 'https://www.clover.com/appmarket/apps/ABC123' }));
    expect(live).toContain('Disponible sur le Clover App Market : https://www.clover.com/appmarket/apps/ABC123');
    expect(live).toContain('Available on the Clover App Market: https://www.clover.com/appmarket/apps/ABC123'); // English: no space before ":"
    expect(hubLlmsTxt(ctx({ livePlatforms: ALL_LIVE }))).toContain(`${BASE}/hub/integrations/doordash-clover`);
  });
});
