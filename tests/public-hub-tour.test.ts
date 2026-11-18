import { existsSync, readFileSync, statSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HubPage } from '../components/public-hub/hub-page';
import { LISTING_BENEFITS } from '../lib/foodhub/clover-listing';
import type { HubContext, HubPageKey } from '../lib/foodhub/public-hub';
import { HUB_SHOTS, shotSrc, TOUR, type ShotKey } from '../lib/foodhub/public-hub-tour';

// The product tour of the public landing (components/public-hub/landing-tour.tsx): real stills that exist on disk,
// honest words, no layout shift, no script. The general public-page rules live in tests/public-hub.test.ts.

const LANGS = ['fr', 'en'] as const;
const ctx = (over: Partial<HubContext> = {}): HubContext => ({
  base: 'https://foodhub.on2go.ca', appMarketUrl: null, sameAs: [], supportEmail: null, company: 'Quadro Holdings LTEE',
  address: '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada', marketStatus: 'review', livePlatforms: ['uber'], ...over,
});
const render = (page: HubPageKey, lang: 'fr' | 'en', c = ctx()) => renderToStaticMarkup(createElement(HubPage, { page, lang, ctx: c }));
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const BANNED = [/24\s?\/\s?7/i, /\b24\s?h\b/i, /virtuel/i, /\bvirtual\b/i, /\bghost\b/i, /dark kitchen/i, /cuisine fantôme/i, /futuris/i, /révolution/i,
  /revolution/i, /\bmeilleur\b/i, /\bbest\b/i, /\b#1\b/, /deliverect/i, /\botter\b/i, /cuboh/i, /checkmate/i, /urbanpiper/i, /chowly/i, /ordermark/i,
  /bientôt|coming soon|prévu|planned/i, /po\s*poulet/i];
const imgs = (html: string) => html.match(/<img [^>]*>/g) ?? [];

describe('landing product tour (/hub, /en/hub)', () => {
  it('every still exists on disk at each listed width, as a light WebP', () => {
    for (const key of Object.keys(HUB_SHOTS) as ShotKey[]) for (const lang of LANGS) for (const w of HUB_SHOTS[key].widths) {
      const file = `public${shotSrc(key, lang, w)}`;
      expect(existsSync(file), file).toBe(true);
      expect(statSync(file).size, file).toBeLessThan(150_000);
      expect(readFileSync(file).subarray(8, 12).toString('ascii'), file).toBe('WEBP');
    }
  });
  it('renders the benefits, every section and the demo note on the landing only, with no script', () => {
    for (const lang of LANGS) {
      const w = TOUR[lang];
      const html = render('landing', lang);
      const text = visibleText(html);
      for (const b of LISTING_BENEFITS) expect(text).toContain(b[lang]);
      for (const sec of w.sections) {
        expect(text, sec.id).toContain(sec.title);
        expect(text, sec.id).toContain(sec.text);
        for (const p of sec.points) expect(text, sec.id).toContain(p);
        expect(html).toContain(`id="${sec.id}"`);
      }
      expect(text).toContain(w.demoNote);
      expect(html).toContain(`id="${lang === 'fr' ? 'produit' : 'product'}"`); // the header link target
      expect(html).toContain('id="integrations"');
      expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
      const other = visibleText(render('pricing', lang));
      expect(other).not.toContain(w.tourTitle);
      expect(imgs(render('pricing', lang))).toHaveLength(0);
    }
  });
  it('each picture has its alt text, its size (no layout shift) and a srcset; only the hero loads first', () => {
    for (const lang of LANGS) {
      const list = imgs(render('landing', lang));
      const expected = 1 + TOUR[lang].sections.length + TOUR[lang].sections.filter((s) => s.inset).length;
      expect(list).toHaveLength(expected);
      for (const tag of list) {
        expect(tag).toMatch(/ alt="[^"]{20,}"/);
        expect(tag).toMatch(/ width="\d+"/);
        expect(tag).toMatch(/ height="\d+"/);
        expect(tag).toMatch(/ srcSet="[^"]+ \d+w, [^"]+ \d+w"/);
        expect(tag).toContain('decoding="async"');
      }
      expect(list[0]).toContain('loading="eager"');
      expect(list[0]).toContain('fetchPriority="high"');
      expect(list[0]).toContain(`/hub-media/orders-${lang}-1280.webp`);
      for (const tag of list.slice(1)) expect(tag).toContain('loading="lazy"');
      // the console speaks the visitor's language
      for (const tag of list) if (!tag.includes('ordering-phone')) expect(tag).toContain(`-${lang}-`);
    }
  });
  it('the words carry none of the banned claims or names, and every alt text is unique', () => {
    for (const lang of LANGS) {
      const all = JSON.stringify(TOUR[lang]);
      expect(BANNED.filter((r) => r.test(all)).map(String), lang).toEqual([]);
      const alts = [TOUR[lang].heroAlt, ...TOUR[lang].sections.flatMap((s) => [s.alt, s.insetAlt ?? ''])].filter(Boolean);
      expect(new Set(alts).size).toBe(alts.length);
      expect(TOUR.fr.sections.map((s) => s.shot)).toEqual(TOUR.en.sections.map((s) => s.shot));
    }
  });
  it('the landing CSS is static: no animation to pause, no image download for the hero glow', () => {
    const css = readFileSync('components/public-hub/landing.module.css', 'utf8');
    expect(css).not.toMatch(/animation\s*:|@keyframes/);
    expect(css).not.toMatch(/url\(/);
  });
});
