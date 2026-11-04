import { existsSync, readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HubPage } from '../components/public-hub/hub-page';
import { RESTAURANT_COPY } from '../components/public-hub/restaurant-copy';
import { EXTRA_BRAND_PLATFORM_CAD, formatCadLabel, STANDARD_MONTHLY_CAD, TRIAL_DAYS } from '../lib/foodhub/pricing';
import { HUB_PATHS, hubFaq, type HubContext } from '../lib/foodhub/public-hub';

const LANGS = ['fr', 'en'] as const;
const ctx = (over: Partial<HubContext> = {}): HubContext => ({
  base: 'https://foodhub.on2go.ca', appMarketUrl: null, sameAs: [], supportEmail: null, company: 'Quadro Holdings LTEE',
  address: '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada', marketStatus: 'review', livePlatforms: ['uber'], ...over,
});
const render = (lang: 'fr' | 'en', c = ctx()) => renderToStaticMarkup(createElement(HubPage, { page: 'landing', lang, ctx: c }));
const textOf = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');

describe('restaurant merchant landing (/hub and /en/hub)', () => {
  it('gives both languages a complete merchant page, anchor navigation and a separate diner destination', () => {
    for (const lang of LANGS) {
      const html = render(lang); const text = textOf(html); const w = RESTAURANT_COPY[lang];
      expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
      for (const id of ['contenu', 'fonctionnement', 'integrations', 'tarifs']) expect(html).toContain(`id="${id}"`);
      for (const anchor of ['#contenu', '#fonctionnement', '#integrations', '#tarifs']) expect(html).toContain(`href="${anchor}"`);
      expect(text).toContain(w.hero); expect(text).toContain(w.heroAccent);
      expect(text).toContain(w.diner); expect(html).toContain('href="https://on2go.ca/"');
      expect(html).toContain(`href="${HUB_PATHS.landing[lang === 'fr' ? 'en' : 'fr']}"`);
      expect(html).toContain('href="/login"');
      for (const path of ['/legal/support', '/legal/privacy', '/legal/terms']) expect(html).toContain(`href="${path}"`);
    }
  });

  it('offers an actionable contact CTA while marketplace installation is unavailable', () => {
    for (const marketStatus of ['review', 'soon'] as const) {
      const html = render('fr', ctx({ marketStatus }));
      expect(html).toMatch(/href="mailto:support@takatak.ca"[^>]*>Parler de mon restaurant/);
      expect(html).not.toMatch(/<span[^>]*>Installer avec Clover/);
      expect(html).not.toContain('data-clover-badges');
    }
    const email = render('en', ctx({ supportEmail: 'support@example.com' }));
    expect(email).toMatch(/href="mailto:support@example.com"[^>]*>Talk about my restaurant/);
    const market = 'https://www.clover.com/appmarket/apps/ABC123';
    const live = render('en', ctx({ appMarketUrl: market, marketStatus: 'live' }));
    expect(live).toMatch(/href="https:\/\/www.clover.com\/appmarket\/apps\/ABC123"[^>]*>Install with Clover/);
    expect(textOf(live)).not.toContain(RESTAURANT_COPY.en.review);
  });

  it('shows neutral setup requirements even when all public provider flags are on', () => {
    for (const lang of LANGS) {
      const html = render(lang, ctx({ livePlatforms: ['uber', 'doordash', 'skip'] }));
      const text = textOf(html);
      expect(text.match(new RegExp(RESTAURANT_COPY[lang].setupRequired, 'g'))).toHaveLength(3);
      expect(text).toContain(RESTAURANT_COPY[lang].availability);
      expect(text).not.toMatch(/Uber Eats (Available|Disponible)|DoorDash (Available|Disponible)|SkipTheDishes (Available|Disponible)/);
    }
  });

  it('distinguishes manual hosted sessions from an authorized API connection', () => {
    for (const lang of LANGS) {
      const text = textOf(render(lang)); const w = RESTAURANT_COPY[lang];
      expect(text).toContain(w.tabletPrivacy); expect(text).toContain(w.tabletSetup); expect(text).toContain(w.tabletCaption);
      expect(text).toContain(lang === 'fr' ? 'Afficher un écran ne l’active pas.' : 'Displaying a screen does not enable it.');
      expect(text).not.toMatch(/54 (live|active)|54 (actifs|en direct)|18 (live|active)/i);
      expect(render(lang)).not.toContain('<iframe');
    }
  });

  it('uses public, documented real photographs and an explicitly labelled actual sandbox capture', () => {
    for (const path of ['restaurant-counter.webp', 'tablet-wall-demo.webp']) {
      expect(existsSync(`public/hub-media/${path}`), path).toBe(true);
      expect(render('fr')).toContain(encodeURIComponent(`/hub-media/${path}`));
    }
    const credits = readFileSync('public/hub-media/CREDITS.md', 'utf8');
    expect(credits).toContain('Unsplash License'); expect(credits).toContain('not real provider sessions');
    expect(render('en')).not.toMatch(/data:image|<canvas|<svg[^>]*>.*animateMotion/);
  });

  it('preserves the pricing source, independent phone product and billing disclosure', () => {
    for (const lang of LANGS) {
      const html = render(lang); const text = textOf(html);
      expect(text).toContain(formatCadLabel(STANDARD_MONTHLY_CAD, lang));
      expect(text).toContain(formatCadLabel(EXTRA_BRAND_PLATFORM_CAD, lang));
      expect(text).toContain(`${TRIAL_DAYS} ${RESTAURANT_COPY[lang].trial}`);
      expect(text).toContain(RESTAURANT_COPY[lang].tax);
      expect(text).toContain(RESTAURANT_COPY[lang].phoneText);
      expect(html).toContain(`href="${HUB_PATHS.phone[lang]}"`);
      const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
      expect(ld['@graph'].find((node: { '@type': string }) => node['@type'] === 'SoftwareApplication').offers).toBeUndefined();
    }
  });

  it('keeps structured FAQ answers equal to the readable native disclosure content', () => {
    for (const lang of LANGS) {
      const html = render(lang); const text = textOf(html);
      for (const f of hubFaq('landing', lang, ctx())) { expect(text).toContain(f.q); expect(text).toContain(f.a); }
      expect(html.match(/<details/g)?.length).toBe(hubFaq('landing', lang, ctx()).length + 2); // mobile menu + film description
      expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
    }
  });

  it('offers the language-matched real walkthrough with native controls, captions and a readable description', () => {
    for (const lang of LANGS) {
      const html = render(lang);
      expect(html).toMatch(/<video[^>]*controls[^>]*preload="none"/);
      expect(html).not.toMatch(/<video[^>]*autoPlay|<video[^>]*autoplay/);
      expect(html).toContain(`src="/hub-media/foodhub-product-demo-${lang}.mp4"`);
      expect(html).toContain(`src="/hub-media/foodhub-product-demo-${lang}.vtt"`);
      expect(textOf(html)).toContain(RESTAURANT_COPY[lang].videoCaption);
      expect(textOf(html)).toContain(RESTAURANT_COPY[lang].videoTranscript);
    }
  });

  it('retires the animated brain/sparkles presentation and honors reduced motion', () => {
    const css = readFileSync('components/public-hub/restaurant-landing.module.css', 'utf8');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    for (const lang of LANGS) {
      const html = render(lang); const text = textOf(html);
      expect(html).not.toContain('hub-motion-off'); expect(html).not.toContain('hub-feature');
      expect(text).not.toMatch(/one brain|un seul cerveau|click a feature|cliquez sur une fonction|within seconds|en quelques secondes/i);
      const subpage = renderToStaticMarkup(createElement(HubPage, { page: 'pricing', lang, ctx: ctx() }));
      expect(textOf(subpage)).not.toContain(RESTAURANT_COPY[lang].hero);
    }
  });
});
