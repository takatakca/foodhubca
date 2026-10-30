import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { HubPage } from '../components/public-hub/hub-page';
import { LISTING_BENEFITS, LISTING_DESCRIPTION } from '../lib/foodhub/clover-listing';
import type { HubContext, HubPageKey } from '../lib/foodhub/public-hub';
import { SHOWCASE } from '../lib/foodhub/public-hub-showcase';

// The premium visuals of the public landing (components/public-hub/landing-showcase.tsx): honest words, real states,
// no page script, every motion stoppable. The general public-page rules live in tests/public-hub.test.ts.

const LANGS = ['fr', 'en'] as const;
const ctx = (over: Partial<HubContext> = {}): HubContext => ({
  base: 'https://foodhub.on2go.ca', appMarketUrl: null, sameAs: [], supportEmail: null, company: 'Quadro Holdings LTEE',
  address: '6280, av. Somerled, Montréal (Québec) H3X 2B6, Canada', marketStatus: 'review', livePlatforms: ['uber'], ...over,
});
const render = (page: HubPageKey, lang: 'fr' | 'en', c = ctx()) => renderToStaticMarkup(createElement(HubPage, { page, lang, ctx: c }));
const visibleText = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '\'').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const BANNED = [/24\s?\/\s?7/i, /\b24\s?h\b/i, /virtuel/i, /\bvirtual\b/i, /\bghost\b/i, /dark kitchen/i, /cuisine fantôme/i, /futuris/i,
  /deliverect/i, /\botter\b/i, /cuboh/i, /checkmate/i, /urbanpiper/i, /chowly/i, /ordermark/i, /bientôt|coming soon|prévu|planned/i];

describe('premium landing showcase (/hub, /en/hub)', () => {
  it('renders on the landing only, with every section, and adds no script', () => {
    for (const lang of LANGS) {
      const w = SHOWCASE[lang];
      const html = render('landing', lang);
      const text = visibleText(html);
      for (const s of [w.brainTitle, w.tabletTitle, w.menuTitle, w.explorerTitle, w.integrationsTitle, w.demoNote]) expect(text, s).toContain(s);
      for (const f of w.features) { expect(text).toContain(f.title); expect(text).toContain(f.text); }
      for (const f of w.facts) expect(text).toContain(f.big);
      expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
      expect(html).toContain('id="integrations"'); // the nav link target still exists
      expect(text).not.toContain(w.brainTitle.repeat(2));
      const other = render('pricing', lang);
      expect(visibleText(other)).not.toContain(w.brainTitle);
      expect(other).not.toContain('hub-feature');
    }
  });
  it('the words carry none of the banned claims or names', () => {
    for (const lang of LANGS) {
      const all = JSON.stringify(SHOWCASE[lang]);
      expect(BANNED.filter((r) => r.test(all)).map(String), lang).toEqual([]);
      expect(BANNED.filter((r) => r.test(visibleText(render('landing', lang)))).map(String), lang).toEqual([]);
    }
  });
  it('the feature explorer is CSS-only tabs: one radio per feature, the first checked, each label tied to its input', () => {
    const html = render('landing', 'fr');
    const radios = (html.match(/<input [^>]*>/g) ?? []).filter((i) => i.includes('type="radio"') && i.includes('name="hub-feature"'));
    expect(radios).toHaveLength(SHOWCASE.fr.features.length);
    expect(radios.filter((r) => r.includes('checked'))).toHaveLength(1);
    expect(radios[0]).toContain('checked');
    for (const f of SHOWCASE.fr.features) {
      expect(html).toContain(`id="hub-feature-${f.id}"`);
      expect(html).toContain(`for="hub-feature-${f.id}"`);
      expect(html).toContain(`data-tab="${f.id}"`);
    }
    const css = readFileSync('components/public-hub/landing.module.css', 'utf8');
    for (const f of SHOWCASE.fr.features) expect(css, f.id).toContain(`input[value='${f.id}']:checked`);
    expect(css).toContain('@supports not selector(:has(*))'); // older browsers see every panel
  });
  it('every motion stops under prefers-reduced-motion', () => {
    const css = readFileSync('components/public-hub/landing.module.css', 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    const before = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'));
    // The subject of each animated rule: the last class of every comma-separated selector whose block sets `animation:`.
    const animated = [...before.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[;\s])animation:/.test(m[2]) && !/animation:\s*none/.test(m[2]))
      .flatMap((m) => m[1].split(',').map((sel) => [...sel.matchAll(/\.([a-zA-Z]+)/g)].at(-1)?.[1]))
      .filter((c): c is string => Boolean(c));
    expect(animated.length).toBeGreaterThan(10);
    for (const cls of new Set(animated)) expect(reduced, cls).toContain(`.${cls}`);
    expect(reduced).toContain('.packet { display: none; }'); // the SVG packets move with <animateMotion>
  });
  it('a visitor can stop every motion (WCAG 2.2.2): a labelled checkbox in the hero, scoped to the landing', () => {
    for (const lang of LANGS) {
      const html = render('landing', lang);
      expect(html).toMatch(/<input [^>]*type="checkbox"[^>]*id="hub-motion-off"/);
      expect(html).toContain('for="hub-motion-off"');
      expect(visibleText(html)).toContain(SHOWCASE[lang].motionOff);
      expect(html).toMatch(/<div lang="[^"]+" class="[^"]*_motionScope_/); // the page root holds the scope
      expect(render('pricing', lang)).not.toContain('hub-motion-off');
    }
    const css = readFileSync('components/public-hub/landing.module.css', 'utf8');
    expect(css).toContain('.motionScope:has(.motionOff:checked) *,');
    expect(css).toMatch(/\.motionScope:has\(\.motionOff:checked\) \*::after \{ animation: none !important; \}/);
    expect(css).toContain('.motionScope:has(.motionOff:checked) .packet { display: none; }'); // SVG <animateMotion> packets
  });
  it('no element carries two classes that both set the `animation` shorthand (the later one would cancel the other)', () => {
    const css = readFileSync('components/public-hub/landing.module.css', 'utf8');
    const before = css.slice(0, css.indexOf('@media (prefers-reduced-motion: reduce)'));
    // Classes whose own element animates: the last compound of each selector, pseudo-elements excluded.
    const own = new Set([...before.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter((m) => /(^|[;\s])animation:/.test(m[2]) && !/animation:\s*none/.test(m[2]))
      .flatMap((m) => m[1].split(',').map((sel) => sel.trim()).filter((sel) => !sel.includes('::'))
        .map((sel) => [...(sel.split(/\s+/).at(-1) ?? '').matchAll(/\.([a-zA-Z]+)/g)].at(-1)?.[1]))
      .filter((c): c is string => Boolean(c)));
    expect(own.has('orderIn') && own.has('ringing')).toBe(true);
    for (const lang of LANGS) {
      for (const [, cls] of render('landing', lang).matchAll(/class="([^"]*)"/g)) {
        const hits = [...own].filter((c) => new RegExp(`(^|\\s)_${c}_`).test(cls));
        expect(hits.length, `${lang}: ${cls}`).toBeLessThanOrEqual(1);
      }
    }
  });
  it('the demo orders are an illustration hidden from screen readers, and say so', () => {
    for (const lang of LANGS) {
      const html = render('landing', lang);
      for (const o of SHOWCASE[lang].orders) {
        const at = html.indexOf(`#${o.ref}`);
        expect(at, o.ref).toBeGreaterThan(-1);
        expect(html.lastIndexOf('aria-hidden="true"', at)).toBeGreaterThan(-1);
      }
      expect(visibleText(html)).toContain(SHOWCASE[lang].demoNote);
    }
  });
  it('platform states are real: « in certification » until approved, nothing about certification once all are live', () => {
    const fr = visibleText(render('landing', 'fr'));
    expect(fr).toContain('Uber Eats Disponible');
    expect(fr).toContain('DoorDash Certification en cours');
    expect(fr).toContain('SkipTheDishes Certification en cours');
    const allLive = visibleText(render('landing', 'en', ctx({ livePlatforms: ['uber', 'doordash', 'skip'] })));
    expect(allLive).toContain('DoorDash Available');
    expect(allLive).not.toMatch(/certification/i);
    expect(fr).toContain('Too Good To Go : lorsque votre compte offre un flux de commandes.');
  });
  it('« another register? » writes to support: the email when set, else the support page', () => {
    expect(render('landing', 'fr')).not.toContain('mailto:');
    expect(render('landing', 'fr')).toContain('href="/legal/support"');
    expect(render('landing', 'en', ctx({ supportEmail: 'support@example.com' }))).toContain('href="mailto:support@example.com"');
  });
  it('the claims come from the Clover listing (seconds for sold-out items, payouts checked, Clover order types)', () => {
    const listing = [LISTING_DESCRIPTION, ...LISTING_BENEFITS].map((b) => `${b.fr} ${b.en}`).join(' ').toLowerCase();
    expect(listing).toMatch(/quelques secondes|within seconds/);
    expect(listing).toMatch(/paiement|payout/);
    expect(listing).toContain('order type per platform');
  });
});
