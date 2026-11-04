import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HubPage } from '../components/public-hub/hub-page';
import { liveCloverApps } from '../lib/foodhub/clover-apps';
import { formatCadLabel, EXTRA_BRAND_PLATFORM_CAD, PHONE_MINUTE_CAD } from '../lib/foodhub/pricing';
import { HUB_PAGE_KEYS, HUB_PATHS, hubJsonLd, hubMarketUrl, hubMetadata, hubPageAt, hubPageMarketUrl, hubSitemap, type HubContext, type HubPageKey } from '../lib/foodhub/public-hub';

const context = (override: Partial<HubContext> = {}): HubContext => ({ base: 'https://foodhub.on2go.ca', appMarketUrl: null, cloverApps: [], marketStatus: 'review', livePlatforms: [], sameAs: [], supportEmail: null, company: 'Company Example', address: 'Montréal, Canada', ...override });
const render = (page: HubPageKey, lang: 'fr' | 'en', ctx = context()) => renderToStaticMarkup(createElement(HubPage, { page, lang, ctx }));
const text = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const hero = (html: string) => html.match(/<section[^>]+aria-labelledby="detail-title"[^>]*>([\s\S]*?)<\/section>/)![1];
const appOf = (page: HubPageKey, ctx: HubContext) => (hubJsonLd(page, 'en', ctx)['@graph'] as Array<Record<string, unknown>>).find((node) => node['@type'] === 'SoftwareApplication')!;

describe('complete public restaurant journeys', () => {
  it('keeps each language switch on the same product/help page with valid local section anchors', () => {
    for (const page of HUB_PAGE_KEYS) for (const lang of ['fr', 'en'] as const) {
      const html = render(page, lang);
      expect(html).toContain(`href="${HUB_PATHS[page][lang === 'fr' ? 'en' : 'fr']}"`);
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      expect(html).toContain('Food Hub');
      expect(html).not.toContain('hub-motion-off');
      for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) expect(html, `${page}/${lang}: ${id}`).toContain(`id="${id}"`);
      for (const [, href] of html.matchAll(/href="((?:\/en)?\/hub(?:\/[^"#]*)?)(?:#[^"]*)?"/g)) expect(hubPageAt(href.split('?')[0]), `${page}/${lang}: ${href}`).not.toBeNull();
    }
  });

  it('makes both help routes public, indexable and available in the shared navigation', () => {
    for (const lang of ['fr', 'en'] as const) {
      expect(hubPageAt(HUB_PATHS.help[lang])).toEqual({ key: 'help', lang });
      expect(hubMetadata('help', lang, { base: context().base, livePlatforms: [] }).robots).toEqual({ index: true, follow: true });
      expect(hubSitemap(context().base, false, []).some((entry) => entry.url.endsWith(HUB_PATHS.help[lang]))).toBe(true);
      for (const page of HUB_PAGE_KEYS) expect(render(page, lang)).toContain(`href="${HUB_PATHS.help[lang]}"`);
      const help = text(render('help', lang));
      expect(help).toContain(lang === 'fr' ? 'profils existants' : 'existing profiles');
      expect(help).toContain(lang === 'fr' ? 'Ne transmettez aucun mot de passe' : 'Do not send passwords');
    }
  });

  it('keeps Food Hub and Phone AI installation/Offer eligibility independent in all four availability states', () => {
    for (const flags of ['', 'foodhub', 'phone', 'foodhub,phone']) {
      const apps = liveCloverApps(flags);
      const ctx = context({ cloverApps: apps, appMarketUrl: hubMarketUrl(apps, '') });
      const phone = apps.find((app) => app.key === 'phone');
      const phoneUrl = phone ? `https://www.clover.com/appmarket/apps/${phone.appId}` : null;
      expect(hubPageMarketUrl('phone', ctx)).toBe(phoneUrl);
      expect(hubPageMarketUrl('pricing', ctx)).toBe(ctx.appMarketUrl);
      const phoneHero = hero(render('phone', 'en', ctx));
      if (phoneUrl) {
        expect(phoneHero).toMatch(/>Install TAKATAK Phone AI/);
        expect(phoneHero).toContain(`href="${phoneUrl}"`);
      } else {
        expect(phoneHero).toMatch(/href="\/en\/hub\/contact\?interest=phone"[^>]*>Discuss my phone service/);
        expect(phoneHero).not.toContain('>Install TAKATAK Phone AI');
      }
      const phoneApp = appOf('phone', ctx);
      expect(phoneApp).toMatchObject({ name: 'TAKATAK Phone AI', '@id': `${ctx.base}/hub#phone-ai`, url: `${ctx.base}${HUB_PATHS.phone.fr}` });
      const offer = phoneApp.offers as Record<string, unknown> | undefined;
      if (phoneUrl) {
        expect(offer?.url).toBe(phoneUrl);
        expect(offer?.priceSpecification).toEqual(expect.arrayContaining([
          expect.objectContaining({ price: '50.00', billingDuration: 'P1M' }),
          expect.objectContaining({ price: '0.25', unitCode: 'MIN' }),
        ]));
      } else expect(offer).toBeUndefined();
      expect(appOf('landing', ctx).offers !== undefined).toBe(Boolean(ctx.appMarketUrl));
    }
  });

  it('does not reuse an explicit Food Hub listing URL as a Phone AI installation', () => {
    const ctx = context({ appMarketUrl: 'https://www.clover.com/appmarket/apps/FOODHUB-ONLY', marketStatus: 'live', supportEmail: 'help@example.com' });
    const html = hero(render('phone', 'fr', ctx));
    expect(html).toMatch(/href="\/hub\/contact\?interest=phone"[^>]*>Parler de mon service téléphonique/);
    expect(html).not.toContain('FOODHUB-ONLY');
    expect(appOf('phone', ctx).offers).toBeUndefined();
  });

  it('shows separate plan units and complete phone-minute conditions', () => {
    for (const lang of ['fr', 'en'] as const) {
      const plans = [...render('pricing', lang).matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g)].map((match) => match[1]);
      const food = plans.find((plan) => plan.includes('<h3>TAKATAK Food Hub</h3>'))!;
      const phone = plans.find((plan) => plan.includes('<h3>TAKATAK Phone AI</h3>'))!;
      expect(food).toBeDefined(); expect(phone).toBeDefined();
      expect(text(food)).toContain(formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, lang));
      expect(text(food)).not.toContain(formatCadLabel(PHONE_MINUTE_CAD, lang));
      expect(text(phone)).toContain(formatCadLabel(PHONE_MINUTE_CAD, lang));
      expect(text(phone)).not.toContain(formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, lang));
      const definition = text(render('phone', lang));
      expect(definition).toContain(lang === 'fr' ? 'qu’une commande soit passée ou non' : 'whether or not an order is placed');
      expect(definition).toContain(lang === 'fr' ? 'L’attente pendant un transfert et le temps avec le personnel sont exclus' : 'Transfer wait and time with restaurant staff are excluded');
      expect(definition).toContain(lang === 'fr' ? 'ni lorsque l’abonnement Clover n’est pas actif' : 'while the Clover subscription is inactive');
    }
  });

  it('keeps provider readiness and native portal access explicit even with public live flags enabled', () => {
    const ctx = context({ livePlatforms: ['uber', 'doordash', 'skip'] });
    for (const page of ['uber', 'doordash', 'skip'] as const) for (const lang of ['fr', 'en'] as const) {
      const copy = text(render(page, lang, ctx));
      expect(copy).toContain(lang === 'fr' ? 'avant l’activation' : 'before activation');
      expect(copy).toContain(lang === 'fr' ? 'Vous conservez votre compte marchand et son portail' : 'You keep your merchant account and its portal');
      expect(copy).not.toMatch(/within seconds|en quelques secondes|no more.*tablet|plus à surveiller une tablette|every payout|chaque versement|au cent près/i);
    }
  });
});
