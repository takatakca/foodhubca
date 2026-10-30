// Brand kit (MASTER_PLAN Phase 3 P1, docs/BRAND_KIT.md): accent colour + logo per brand, validated on the server,
// exposed as --brand-accent / --brand-on-accent, and no change at all for a brand that has neither.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  ACCENT_RE, accentReport, brandKitOf, brandKitsOf, brandVars, contrastRatio, kitFor, LOGO_MAX_LENGTH, MEDIA_LOGO_RE,
  onAccentColor, parseAccent, parseLogo, TEXT_MIN_CONTRAST, type BrandKit,
} from '@/lib/foodhub/brand-kit';
import { MEDIA_NAME_RE } from '@/lib/foodhub/media';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {}, prefetch() {}, back() {} }),
  usePathname: () => '/orders',
  useSearchParams: () => new URLSearchParams(),
}));

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
const post = (body: unknown) => new Request('http://hub.local/api/foodhub/catalog', {
  method: 'POST', headers: { authorization: basic('owner', 'Owner-pass-123'), 'content-type': 'application/json' }, body: JSON.stringify(body),
});
const ctx = {} as never;
const MEDIA = '/media/0123456789abcdef01234567.png';

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.DASHBOARD_PASSWORD = 'Owner-pass-123';
  (globalThis as { __foodhubMem?: unknown }).__foodhubMem = undefined;
});

describe('validation: hex only for the colour', () => {
  it('accepts #RRGGBB (stored lower-case) and reads empty as "no colour"', () => {
    expect(parseAccent('#1565D8')).toEqual({ ok: true, value: '#1565d8' });
    expect(parseAccent(' #0e7c86 ')).toEqual({ ok: true, value: '#0e7c86' });
    expect(parseAccent('')).toEqual({ ok: true, value: null });
    expect(parseAccent(null)).toEqual({ ok: true, value: null });
    expect(parseAccent(undefined)).toEqual({ ok: true, value: null });
  });
  it('refuses every other form, including CSS injection attempts', () => {
    for (const bad of ['#abc', 'red', '1565d8', '#1565d', '#1565d88', '#12345g', 'rgb(1,2,3)', '#1565d8;background:url(x)', 'var(--x)', '#1565d8 !important', 123, {}, ['#1565d8']]) {
      const r = parseAccent(bad);
      expect(r.ok, String(bad)).toBe(false);
    }
  });
});

describe('validation: https or a media library photo for the logo', () => {
  it('accepts an https address and a /media/<name> photo', () => {
    expect(parseLogo('https://cdn.example.com/brand/logo.png')).toEqual({ ok: true, value: 'https://cdn.example.com/brand/logo.png' });
    expect(parseLogo(MEDIA)).toEqual({ ok: true, value: MEDIA });
    expect(parseLogo('')).toEqual({ ok: true, value: null });
    expect(parseLogo(null)).toEqual({ ok: true, value: null });
  });
  it('refuses javascript:, data:, http: and other tricks', () => {
    for (const bad of [
      'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
      'data:image/png;base64,iVBORw0KGgo=', 'data:image/svg+xml,<svg onload=alert(1)>',
      'http://example.com/logo.png', '//example.com/logo.png', 'ftp://example.com/logo.png', 'vbscript:msgbox(1)',
      'https://user:secret@example.com/logo.png', 'https://localhost/logo.png', 'https://example.com/a b.png',
      'https://example.com/"onerror="alert(1).png', '/media/../../etc/passwd', '/media/abc.png', '/logo.png', 'logo.png', 42,
      `https://example.com/${'a'.repeat(LOGO_MAX_LENGTH)}.png`,
    ]) {
      expect(parseLogo(bad).ok, String(bad)).toBe(false);
    }
  });
  it('the media photo rule matches the media library file names exactly', () => {
    for (const name of ['0123456789abcdef01234567.png', 'abcdefabcdefabcdefabcdef.jpg', 'ffffffffffffffffffffffff.webp', 'ABCDEF0123456789abcdef01.png', '0123456789abcdef0123456.png', '0123456789abcdef01234567.gif']) {
      expect(MEDIA_LOGO_RE.test(`/media/${name}`), name).toBe(MEDIA_NAME_RE.test(name));
    }
  });
});

describe('contrast helper (WCAG)', () => {
  it('computes the WCAG ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#1565d8', '#1565d8')).toBe(1);
    expect(contrastRatio('#ffffff', '#767676')).toBeCloseTo(4.54, 2);
  });
  it('picks black or white for the text on the accent', () => {
    expect(onAccentColor('#ffeb3b')).toBe('#000000');
    expect(onAccentColor('#1565d8')).toBe('#ffffff');
    expect(onAccentColor('#000000')).toBe('#ffffff');
    expect(onAccentColor('#ffffff')).toBe('#000000');
  });
  it('the text on any accent reaches AA 4.5:1', () => {
    let worst = 21;
    for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
      const hex = `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
      worst = Math.min(worst, contrastRatio(hex, onAccentColor(hex)));
    }
    expect(worst).toBeGreaterThanOrEqual(TEXT_MIN_CONTRAST);
  });
  it('warns when the accent is too light on white (or too dark on the kitchen screen)', () => {
    expect(accentReport('#ffeb3b').tooLightOnWhite).toBe(true);
    expect(accentReport('#1565d8').tooLightOnWhite).toBe(false);
    expect(accentReport('#1565d8').textPasses).toBe(true);
    expect(accentReport('#0d1730').tooDarkOnKitchen).toBe(true);
    expect(accentReport('#29c3ff').tooDarkOnKitchen).toBe(false);
  });
});

describe('the kit sent to the console', () => {
  it('re-checks stored values: anything that is not #rrggbb / https / media never reaches a style', () => {
    expect(brandKitOf({})).toBeNull();
    expect(brandKitOf({ accent: 'red; background:url(javascript:alert(1))', logo: 'javascript:alert(1)' })).toBeNull();
    expect(brandKitOf({ accent: '#ABCDEF' })).toEqual({ accent: '#abcdef', onAccent: '#000000' });
    expect(brandKitOf({ logo: MEDIA })).toEqual({ logo: MEDIA });
    const kits = brandKitsOf([{ name: 'A', accent: '#c2367a' }, { name: 'B' }, { name: 'C', accent: 'blue' }, { name: '__proto__', accent: '#000000' }]);
    expect(Object.keys(kits)).toEqual(['A']);
    expect(kitFor(kits, 'constructor')).toBeNull();
    expect(kitFor(kits, 'toString')).toBeNull();
    expect(kitFor(kits, 'A')?.accent).toBe('#c2367a');
  });
  it('brandVars writes only the two validated variables, and nothing for a brand without a colour', () => {
    expect(brandVars(null)).toBeUndefined();
    expect(brandVars({ logo: MEDIA })).toBeUndefined();
    expect(brandVars({ accent: 'red;x:y' } as BrandKit)).toBeUndefined();
    expect(brandVars({ accent: '#1565d8', onAccent: '#ffffff' })).toEqual({ '--brand-accent': '#1565d8', '--brand-on-accent': '#ffffff' });
    expect(ACCENT_RE.test('#1565d8')).toBe(true);
  });
});

describe('saving a brand (POST /api/foodhub/catalog)', () => {
  it('refuses a bad colour or logo and saves nothing', async () => {
    const { POST } = await import('@/app/api/foodhub/catalog/route');
    const { getCatalog } = await import('@/lib/foodhub/catalog');
    for (const brand of [
      { name: 'Kit Test', active: true, accent: 'javascript:alert(1)' },
      { name: 'Kit Test', active: true, accent: '#abc' },
      { name: 'Kit Test', active: true, logo: 'javascript:alert(1)' },
      { name: 'Kit Test', active: true, logo: 'data:image/png;base64,iVBORw0KGgo=' },
      { name: 'Kit Test', active: true, logo: 'http://example.com/logo.png' },
    ]) {
      const res = await POST(post({ brand }), ctx);
      expect(res.status, JSON.stringify(brand)).toBe(400);
    }
    expect((await getCatalog()).brands.some((b) => b.name === 'Kit Test')).toBe(false);
  });

  it('saves, keeps the kit when the brand is turned off and on, and removes it on request', async () => {
    const { POST } = await import('@/app/api/foodhub/catalog/route');
    const { getCatalog } = await import('@/lib/foodhub/catalog');
    const find = async () => (await getCatalog()).brands.find((b) => b.name === 'Kit Test');
    expect((await POST(post({ brand: { name: 'Kit Test', active: true, accent: '#C2367A', logo: 'https://cdn.example.com/logo.png' } }), ctx)).status).toBe(200);
    expect(await find()).toMatchObject({ accent: '#c2367a', logo: 'https://cdn.example.com/logo.png', active: true });
    await POST(post({ brand: { name: 'Kit Test', active: false } }), ctx);
    expect(await find()).toMatchObject({ accent: '#c2367a', logo: 'https://cdn.example.com/logo.png', active: false });
    await POST(post({ brand: { name: 'Kit Test', active: true, accent: '', logo: null } }), ctx);
    const cleared = await find();
    expect(cleared).toMatchObject({ active: true });
    expect(cleared && 'accent' in cleared).toBe(false);
    expect(cleared && 'logo' in cleared).toBe(false);
  });

  it('a value edited by hand in the database is dropped on the way to the console', async () => {
    const { getRepo } = await import('@/lib/foodhub/repo');
    const { getCatalog } = await import('@/lib/foodhub/catalog');
    await getRepo().setKv('catalog', { brands: [{ name: 'Hand Edit', active: true, accent: '#fff;background:url(javascript:alert(1))', logo: 'javascript:alert(1)' }, { name: 'Good', active: true, accent: '#0e7c86' }] });
    const kits = brandKitsOf((await getCatalog()).brands);
    expect(kits['Hand Edit']).toBeUndefined();
    expect(kits.Good).toEqual({ accent: '#0e7c86', onAccent: '#ffffff' });
  });
});

// ---------- rendering: the default look is unchanged, the variable is on the order card ----------
const VIEWER = { username: 'owner', name: 'Owner', role: 'owner', locations: [], permissions: ['view'], builtin: true, hasPin: false, email: null, phone: null, device: null, lang: 'fr' };
const ORDER = {
  id: 'o1', channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: 'ext-1', displayId: 'A12', channelStoreId: 's1', brandName: 'Pizza Test',
  fulfillment: 'pickup', placedAt: '2026-10-30T12:00:00Z', createdAt: '2026-10-30T12:00:00Z', currency: 'CAD', deliveryFee: 0, tip: 0, discount: 0,
  lines: [{ name: 'Poutine', quantity: 2, modifiers: [], notes: null }], subtotal: 10, tax: 1.5, total: 11.5, raw: {}, locationCode: 'NDG_MAIN',
  status: 'accepted', timeline: { seenAt: '2026-10-30T12:01:00Z' }, actions: [],
};

async function renderCard(kits: Record<string, BrandKit>) {
  const { ViewerProvider } = await import('@/components/shell/viewer');
  const { ToastProvider } = await import('@/components/ui/toast');
  const { OrderCard } = await import('@/components/live/order-card');
  const wrap = (child: ReactNode) => createElement(ToastProvider, null, createElement(ViewerProvider, { viewer: VIEWER as never, catalog: { locations: [{ code: 'NDG_MAIN', name: 'NDG MAIN' }], brands: ['Pizza Test'], brandKits: kits } }, child));
  return renderToStaticMarkup(wrap(createElement(OrderCard, { o: ORDER as never, onOpen: () => undefined })));
}

describe('rendering', () => {
  it('BrandMark without a kit is exactly the mark from before brand kits', async () => {
    const { BrandMark } = await import('@/components/ui/brand-mark');
    const html = renderToStaticMarkup(createElement(BrandMark, { name: 'Pizza Test', size: 'sm' }));
    expect(html).toMatch(/^<span aria-hidden="true" class="inline-flex shrink-0 items-center justify-center font-extrabold text-white tracking-tight size-8 text-small rounded-md" style="background:#[0-9a-f]{6}">PT<\/span>$/);
    expect(html).not.toContain('--brand-accent');
  });

  it('BrandMark with a kit: letters in the on-accent colour on the accent, or the logo on white', async () => {
    const { BrandMark } = await import('@/components/ui/brand-mark');
    const coloured = renderToStaticMarkup(createElement(BrandMark, { name: 'Pizza Test', kit: { accent: '#ffeb3b', onAccent: '#000000' } }));
    expect(coloured).toContain('--brand-accent:#ffeb3b');
    expect(coloured).toContain('--brand-on-accent:#000000');
    expect(coloured).toContain('bg-(--brand-accent) text-(--brand-on-accent)');
    const logo = renderToStaticMarkup(createElement(BrandMark, { name: 'Pizza Test', kit: { logo: MEDIA } }));
    expect(logo).toContain(`src="${MEDIA}"`);
    expect(logo).toContain('referrerPolicy="no-referrer"');
    expect(logo).toContain('bg-white');
  });

  it('an order card of a brand without a kit looks exactly as before (no style, no stripe)', async () => {
    const html = await renderCard({});
    expect(html.startsWith('<div class="group rounded-md border bg-surface shadow-card motion-safe:transition-[box-shadow,transform] motion-safe:duration-(--duration-fast) motion-safe:hover:-translate-y-px hover:shadow-pop border-line">')).toBe(true);
    expect(html).not.toContain('--brand-accent');
    expect(html).not.toContain('brand-stripe');
    expect(html).not.toContain('<img');
  });

  it('an order card of a brand with a colour carries --brand-accent and the stripe', async () => {
    const html = await renderCard({ 'Pizza Test': { accent: '#c2367a', onAccent: '#ffffff', logo: MEDIA } });
    const root = html.slice(0, html.indexOf('>') + 1);
    expect(root).toContain('style="--brand-accent:#c2367a;--brand-on-accent:#ffffff"');
    expect(root).toContain('brand-stripe');
    expect(html).toContain(`src="${MEDIA}"`);
  });

  it('the stripe is a border, never a background behind text (the kitchen theme stays readable)', async () => {
    const fs = await import('node:fs/promises');
    const css = await fs.readFile('app/globals.css', 'utf8');
    const rules = css.split('\n').filter((l) => l.includes('var(--brand-accent)'));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) {
      expect(r).not.toMatch(/background/);
      expect(r).not.toMatch(/animation|transition/);
    }
  });
});
