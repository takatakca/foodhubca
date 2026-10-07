// Release 1.4.0 — platform adapters against the real API contracts + Uber menu translation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChannelKey, getAdapter } from '../lib/foodhub/adapters';
import { normalizeDoorDashDetails, parseDoorDashOrder } from '../lib/foodhub/adapters/doordash';
import { amountDivisor, parseGenericOrder } from '../lib/foodhub/adapters/partner';
import { parseSkipOrder } from '../lib/foodhub/adapters/skip';
import { fetchUberStoreStatus, invalidateUberToken, parseUberOrder, requestUberReport, uberAccessToken, uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { sortedCategories, toDoorDashMenu, toSkipMenu, toUberHolidayHours, toUberMenu, UBER_LOCALES } from '../lib/foodhub/menu/translate';
import type { ChannelStore, MasterMenu, PublishContext, WeeklyHours } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: string | null; auth: string | null };
const calls: Call[] = [];
/** Minimal fetch mock: routes by URL regex, records every call. */
function mockFetch(routes: Array<[RegExp, (c: Call, n: number) => { status: number; body?: unknown }]>) {
  calls.length = 0;
  const seen = new Map<RegExp, number>();
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = init.headers as Record<string, string> | undefined;
    const c: Call = { url, method: init.method || 'GET', body: typeof init.body === 'string' ? init.body : init.body ? String(init.body) : null, auth: h?.Authorization ?? null };
    calls.push(c);
    for (const [re, fn] of routes) {
      if (!re.test(url)) continue;
      const n = (seen.get(re) ?? 0) + 1; seen.set(re, n);
      const r = fn(c, n);
      return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response('{}', { status: 404 });
  }));
}
const tokenRoute = (f = (n: number) => `tok-${n}`): [RegExp, (c: Call, n: number) => { status: number; body?: unknown }] => [/auth\.uber\.com\/oauth\/v2\/token$/, (_c, n) => ({ status: 200, body: { access_token: f(n), expires_in: 2592000 } })];

const uberStore: ChannelStore = { id: 's1', channel: 'uber_eats', channelStoreId: 'uuid-1', brandName: 'Po Poulet', locationCode: 'NDG_MAIN', autoAccept: true, online: true, meta: {} };

describe('channel keys', () => {
  it('rejects inherited Object.prototype names and accepts real channels', () => {
    expect(isChannelKey('uber_eats')).toBe(true);
    expect(isChannelKey('tgtg')).toBe(true);
    for (const bad of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty', '']) expect(isChannelKey(bad)).toBe(false);
    expect(() => getAdapter('skip')).not.toThrow();
  });
});

describe('Uber Eats adapter — OAuth token cache and store status', () => {
  beforeEach(() => {
    process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret';
    delete process.env.UBER_ACCESS_TOKEN; delete process.env.UBER_BASE_URL; delete process.env.UBER_AUTH_URL;
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    invalidateUberToken(); invalidateUberToken('report');
  });
  afterEach(() => vi.unstubAllGlobals());

  it('de-duplicates concurrent token requests (one POST for a cold-start burst)', async () => {
    mockFetch([tokenRoute()]);
    const got = await Promise.all([uberAccessToken(), uberAccessToken(), uberAccessToken(), uberAccessToken()]);
    expect(got).toEqual(['tok-1', 'tok-1', 'tok-1', 'tok-1']);
    expect(calls.filter((c) => /oauth\/v2\/token/.test(c.url))).toHaveLength(1);
    expect(await uberAccessToken()).toBe('tok-1'); // cached afterwards, still one token call
    expect(calls).toHaveLength(1);
  });

  it('polls the documented Uber status path (/v1/eats/store/{id}/status) and retries once with a fresh token after a 401', async () => {
    mockFetch([tokenRoute(), [/\/v1\/eats\/store\/uuid-1\/status$/, (c) => (c.auth === 'Bearer tok-1' ? { status: 401, body: { message: 'expired' } } : { status: 200, body: { status: 'ONLINE' } })]]);
    const r = await fetchUberStoreStatus('uuid-1');
    expect(r).toMatchObject({ ok: true, state: 'online' });
    const status = calls.filter((c) => /\/status$/.test(c.url));
    expect(status).toHaveLength(2);
    expect(status[0].url).toBe('https://api.uber.com/v1/eats/store/uuid-1/status');
    expect(status.map((c) => c.auth)).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    expect(calls.filter((c) => /oauth\/v2\/token/.test(c.url))).toHaveLength(2);
  });

  it('treats a 404 on the poll as unknown (keeps the last good state), never as deactivated', async () => {
    mockFetch([tokenRoute(), [/\/status$/, () => ({ status: 404, body: { message: 'store not found' } })]]);
    expect(await fetchUberStoreStatus('gone')).toEqual({ ok: false, state: 'unknown', error: 'Uber status HTTP 404' });
  });

  it('pause/resume posts to /v1/eats/store/{id}/status and retries once on 401', async () => {
    mockFetch([tokenRoute(), [/\/v1\/eats\/store\/uuid-1\/status$/, (c) => (c.auth === 'Bearer tok-1' ? { status: 401 } : { status: 204 })]]);
    const res = await uberEatsAdapter.setStoreOnline(uberStore, false, undefined, 'Lunch rush');
    expect(res.ok).toBe(true);
    const posts = calls.filter((c) => c.method === 'POST' && /\/status$/.test(c.url));
    expect(posts).toHaveLength(2);
    expect(posts[1].url).toBe('https://api.uber.com/v1/eats/store/uuid-1/status');
    expect(JSON.parse(posts[1].body!)).toMatchObject({ status: 'PAUSED', reason: 'Lunch rush' });
  });

  it('does not loop: a second 401 is returned as the error', async () => {
    mockFetch([tokenRoute(), [/\/status$/, () => ({ status: 401 })]]);
    const res = await uberEatsAdapter.setStoreOnline(uberStore, true);
    expect(res).toMatchObject({ ok: false, status: 'error', httpStatus: 401 });
    expect(calls.filter((c) => c.method === 'POST' && /\/status$/.test(c.url))).toHaveLength(2);
  });

  it('never refreshes a static UBER_ACCESS_TOKEN (and says so in readiness)', async () => {
    process.env.UBER_ACCESS_TOKEN = 'static';
    mockFetch([tokenRoute(), [/\/status$/, () => ({ status: 401 })]]);
    expect(await fetchUberStoreStatus('uuid-1')).toMatchObject({ ok: false, state: 'unknown', error: 'Uber status HTTP 401' });
    expect(calls).toHaveLength(1);
    expect(uberEatsAdapter.readiness().note).toMatch(/UBER_ACCESS_TOKEN override/);
  });
});

describe('Uber Eats report request is gated by the live switch', () => {
  beforeEach(() => { process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret'; delete process.env.UBER_ACCESS_TOKEN; invalidateUberToken('report'); });
  afterEach(() => vi.unstubAllGlobals());

  it('is blocked (nothing sent) while LIVE_CONNECTORS_GLOBAL_ENABLED is off', async () => {
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'false';
    mockFetch([tokenRoute()]);
    const r = await requestUberReport(['uuid-1'], '2026-09-01', '2026-09-30');
    expect(r).toMatchObject({ ok: false, status: 'blocked' });
    expect(r.message).toMatch(/LIVE_CONNECTORS_GLOBAL_ENABLED/);
    expect(calls).toHaveLength(0);
  });

  it('sends with the eats.report token when live, retrying once on 401', async () => {
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    mockFetch([tokenRoute((n) => `rep-${n}`), [/\/v1\/eats\/report$/, (c) => (c.auth === 'Bearer rep-1' ? { status: 401 } : { status: 200, body: { workflow_id: 'wf-9' } })]]);
    const r = await requestUberReport(['uuid-1'], '2026-09-01', '2026-09-30');
    expect(r).toMatchObject({ ok: true, workflowId: 'wf-9' });
    const tokenBodies = calls.filter((c) => /oauth\/v2\/token/.test(c.url)).map((c) => new URLSearchParams(c.body || '').get('scope'));
    expect(tokenBodies).toEqual(['eats.report', 'eats.report']);
  });
});

describe('DoorDash store_details: pause vs deactivation by reason', () => {
  it('a merchant pause without end_time is paused, not deactivated', () => {
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'operational_issues', notes: 'Paused from TAKATAK Food Hub' }] })).toEqual({ state: 'paused', detail: 'operational_issues — Paused from TAKATAK Food Hub', until: null });
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'Merchant operational issues' }] }).state).toBe('paused');
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'other', notes: 'Paused from TAKATAK Command Center' }] }).state).toBe('paused');
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'operational_issues', end_time: '2026-10-01T20:00:00Z' }] })).toMatchObject({ state: 'paused', until: '2026-10-01T20:00:00Z' });
  });
  it('DoorDash-initiated reasons stay deactivated', () => {
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'out_of_business' }] })).toMatchObject({ state: 'deactivated', detail: 'out_of_business' });
    expect(normalizeDoorDashDetails({ current_deactivations: [{ reason: 'policy_violation', notes: 'fraud review' }] }).state).toBe('deactivated');
    expect(normalizeDoorDashDetails({ is_active: false })).toMatchObject({ state: 'deactivated', detail: 'Deactivated on DoorDash' });
    expect(normalizeDoorDashDetails({ is_active: true, current_deactivations: [] }).state).toBe('online');
  });
});

describe('order discounts from the platform payload (dollars, default 0)', () => {
  it('Uber: total_promo_applied or the promotions list', () => {
    const base = { id: 'u1', store: { id: 's' }, cart: { items: [] }, payment: { charges: { sub_total: { amount: 3000 }, tax: { amount: 450 }, total: { amount: 1950 } } } };
    expect(parseUberOrder(base)!.discount).toBe(0);
    expect(parseUberOrder({ ...base, payment: { charges: { ...base.payment.charges, total_promo_applied: { amount: 1500, currency_code: 'CAD' } } } })!.discount).toBe(15);
    expect(parseUberOrder({ ...base, payment: { ...base.payment, promotions: [{ promo_discount_value: { amount: 500 } }, { promo_discount_value: { amount: 250 } }] } })!.discount).toBe(7.5);
    expect(parseUberOrder({ ...base, payment: { charges: { ...base.payment.charges, total_promo_applied: { amount_e5: 1234500 } } } })!.discount).toBe(12.345);
  });
  it('DoorDash: merchant-funded discount fields (cents)', () => {
    const base = { id: 'd1', store: { merchant_supplied_id: 'm1' }, subtotal: 2000, tax: 300, categories: [] };
    expect(parseDoorDashOrder(base)!.discount).toBe(0);
    expect(parseDoorDashOrder({ ...base, merchant_funded_discount: 500 })!.discount).toBe(5);
    expect(parseDoorDashOrder({ ...base, discounts: [{ amount: 300, funded_by: 'merchant' }, { amount: 999, funded_by: 'doordash' }] })!.discount).toBe(3);
    expect(parseDoorDashOrder({ order: { ...base, merchant_discount: -250 } })!.discount).toBe(2.5);
  });
  it('Skip (JET): payment.discount or vouchers (cents)', () => {
    const base = { id: 'sk1', posLocationId: 'R1', items: [{ name: 'A', quantity: 1, price: 1000 }], payment: { items_in_cart: { inc_tax: 1150, tax: 150 }, final: { inc_tax: 1150, tax: 150 } }, total: 1150 };
    expect(parseSkipOrder(base)!.discount).toBe(0);
    expect(parseSkipOrder({ ...base, payment: { ...base.payment, discount: { amount: 200 } } })!.discount).toBe(2);
    expect(parseSkipOrder({ ...base, vouchers: [{ amount: 100 }, { amount: 150 }] })!.discount).toBe(2.5);
    expect(parseSkipOrder({ ...base, discount: 300 })!.discount).toBe(3);
  });
});

describe('TGTG amounts: one unit per payload', () => {
  beforeEach(() => { delete process.env.TGTG_AMOUNTS_IN_CENTS; });
  const cents = { id: 't1', storeId: 'tgtg-ndg', items: [{ name: 'Surprise Bag', quantity: 1, price: 599 }], total: 599 };
  it('all-integer payload → cents by default (5.99, never 599)', () => {
    expect(amountDivisor(cents)).toBe(100);
    const o = parseGenericOrder('tgtg', 'tgtg', cents)!;
    expect(o).toMatchObject({ total: 5.99, subtotal: 5.99 });
    expect(o.lines[0]).toMatchObject({ unitPrice: 5.99, total: 5.99 });
    const two = parseGenericOrder('tgtg', 'tgtg', { ...cents, items: [{ name: 'Surprise Bag', quantity: 2, price: 599 }], total: 1198 })!;
    expect(two).toMatchObject({ total: 11.98 });
    expect(two.lines[0]).toMatchObject({ unitPrice: 5.99, total: 11.98 });
  });
  it('any fractional amount → the whole payload is dollars; TGTG_AMOUNTS_IN_CENTS=false → dollars', () => {
    const dollars = parseGenericOrder('tgtg', 'tgtg', { ...cents, items: [{ name: 'Surprise Bag', quantity: 1, price: 5.99 }], total: 5.99, tax: 0 })!;
    expect(dollars).toMatchObject({ total: 5.99, subtotal: 5.99 });
    // mixed: integer item price but fractional total → still dollars everywhere (same divisor)
    const mixed = parseGenericOrder('tgtg', 'tgtg', { ...cents, items: [{ name: 'Bag', quantity: 1, price: 6 }], total: 6.5, tax: 0.5 })!;
    expect(mixed).toMatchObject({ total: 6.5, tax: 0.5 });
    expect(mixed.lines[0].unitPrice).toBe(6);
    process.env.TGTG_AMOUNTS_IN_CENTS = 'false';
    expect(amountDivisor(cents)).toBe(1);
    expect(parseGenericOrder('tgtg', 'tgtg', { ...cents, items: [{ name: 'Bag', quantity: 1, price: 6 }], total: 6 })!.total).toBe(6);
    expect(parseGenericOrder('tgtg', 'tgtg', { hello: 'world' })).toBeNull();
  });
});

describe('menu translation: locale keys, closed days, category order', () => {
  const week = (open: string, close: string, days: string[]): WeeklyHours => {
    const w = { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } as WeeklyHours;
    for (const d of days) (w as any)[d] = [{ open, close }];
    return w;
  };
  const menu: MasterMenu = {
    brandName: 'Po Poulet',
    // Clover-style sortOrder values, out of array order: Desserts (added later) must publish first.
    categories: [{ ref: 'other', name: 'Other', sortOrder: 999 }, { ref: 'mains', name: 'Plats', nameFr: 'Plats principaux', sortOrder: 200 }, { ref: 'desserts', name: 'Desserts', sortOrder: 4 }],
    items: [
      { ref: 'i1', name: 'Grilled chicken', nameFr: 'Poulet grillé', price: 14.99, categoryRef: 'mains', available: true, modifierGroupRefs: [], descriptionFr: 'Avec moutarde' },
      { ref: 'i2', name: 'Tart', price: 5, categoryRef: 'desserts', available: true, modifierGroupRefs: [] },
      { ref: 'i3', name: 'Misc', price: 1, categoryRef: 'other', available: true, modifierGroupRefs: [] },
    ],
    modifierGroups: [],
    updatedAt: new Date().toISOString(),
  };
  const ctx: PublishContext = { hours: week('11:00', '22:00', ['monday', 'tuesday']), holidays: [
    { id: 'h1', date: '2026-12-25', name: 'Noël', locationCodes: [], closed: true },
    { id: 'h2', date: '2026-12-31', name: 'Short', locationCodes: [], closed: false, slots: [{ open: '12:00', close: '16:00' }] },
  ], timezone: 'America/Toronto', today: '2026-10-01', language: 'both' };

  it('Uber MultiLanguageText carries ONE translation (Uber shows only one): French + English together, French first', () => {
    expect(UBER_LOCALES).toEqual({ en: 'en_ca', fr: 'fr_ca' });
    const u = toUberMenu(menu, ctx);
    const item = u.items.find((i: any) => i.id === 'i1') as any;
    expect(item.title.translations).toEqual({ fr_ca: 'Poulet grillé / Grilled chicken' });
    expect(item.description.translations.fr_ca).toContain('moutarde');
    const cat = u.categories.find((c: any) => c.id === 'mains') as any;
    expect(cat.title.translations).toEqual({ fr_ca: 'Plats principaux / Plats' });
    const keys: string[][] = [];
    JSON.stringify(u, (k, v) => { if (k === 'translations' && v && typeof v === 'object') keys.push(Object.keys(v)); return v; });
    expect(keys.every((k) => k.length === 1 && /^[a-z]{2}_[a-z]{2}$/.test(k[0]))).toBe(true);
    expect((u.items.find((i: any) => i.id === 'i2') as any).title.translations).toEqual({ fr_ca: 'Tart' }); // no French name → the name as is
    // English-only and French-only menus use their own locale key.
    expect((toUberMenu(menu, { ...ctx, language: 'en' }).items.find((i: any) => i.id === 'i1') as any).title.translations).toEqual({ en_ca: 'Grilled chicken' });
    expect((toUberMenu(menu, { ...ctx, language: 'fr' }).items.find((i: any) => i.id === 'i1') as any).title.translations).toEqual({ fr_ca: 'Poulet grillé' });
  });

  it('Uber holiday hours: closed all day = one 00:00–00:00 period (as Uber documents)', () => {
    expect(toUberHolidayHours(ctx.holidays)).toEqual({ holiday_hours: {
      '2026-12-25': { open_time_periods: [{ start_time: '00:00', end_time: '00:00' }] },
      '2026-12-31': { open_time_periods: [{ start_time: '12:00', end_time: '16:00' }] },
    } });
  });

  it('DoorDash: closed days omitted from open_hours, closed special day as a full-day closure', () => {
    const d = toDoorDashMenu(menu, 'msid', 'prov', 'ref', ctx);
    expect(d.open_hours).toEqual([
      { day_index: 'MON', start_time: '11:00:00', end_time: '22:00:00' },
      { day_index: 'TUE', start_time: '11:00:00', end_time: '22:00:00' },
    ]);
    expect(d.open_hours.some((h: any) => h.start_time === h.end_time)).toBe(false);
    expect(d.special_hours).toEqual([
      { date: '2026-12-25', closed: true, start_time: '00:00:00', end_time: '23:59:59' },
      { date: '2026-12-31', closed: false, start_time: '12:00:00', end_time: '16:00:00' },
    ]);
    // explicitly closed every day → no open_hours at all
    expect(toDoorDashMenu(menu, 'msid', 'prov', 'ref', { ...ctx, hours: week('11:00', '22:00', []) }).open_hours).toEqual([]);
  });

  it('categories are published in sortOrder on every platform (matches the editor)', () => {
    expect(sortedCategories(menu).map((c) => c.ref)).toEqual(['desserts', 'mains', 'other']);
    const u = toUberMenu(menu, ctx);
    expect(u.categories.map((c: any) => c.id)).toEqual(['desserts', 'mains', 'other']);
    expect(u.menus[0].category_ids).toEqual(['desserts', 'mains', 'other']);
    const d = toDoorDashMenu(menu, 'msid', 'prov', 'ref', ctx);
    expect(d.menu.categories.map((c: any) => [c.merchant_supplied_id, c.sort_id])).toEqual([['desserts', 0], ['mains', 1], ['other', 2]]);
    const s = toSkipMenu(menu, ['R1'], undefined, new Set(), ctx);
    expect(s.menus[0].categories.map((c: any) => c.name)).toEqual(['Desserts', 'Plats principaux / Plats', 'Other']);
  });
});

describe('Skip order timestamps (go-live audit)', () => {
  it('reads unix seconds, unix ms and ISO-8601 alike, and never throws on an unreadable value', async () => {
    const { parseSkipOrder } = await import('../lib/foodhub/adapters/skip');
    const base = { id: 'skip-ts', posLocationId: 'NDG-POPOULET', type: 'delivery', items: [{ name: 'Wrap', quantity: 1, price: 1000 }], payment: { items_in_cart: { inc_tax: 1150, tax: 150 } } };
    expect(parseSkipOrder({ ...base, created_at: '1606780145' })?.placedAt).toBe('2020-11-30T23:49:05.000Z');
    expect(parseSkipOrder({ ...base, created_at: 1606780145000 })?.placedAt).toBe('2020-11-30T23:49:05.000Z');
    expect(parseSkipOrder({ ...base, created_at: '2023-01-11T09:47:18Z', collect_at: '2023-01-11T10:15:00Z' })?.readyBy).toBe('2023-01-11T10:15:00.000Z');
    expect(() => parseSkipOrder({ ...base, created_at: 'not a date', collect_at: 'later' })).not.toThrow();
    expect(parseSkipOrder({ ...base, collect_at: 'later' })?.readyBy).toBeUndefined();
  });
});

describe('Uber courier states (go-live audit)', () => {
  it('maps every documented state, and "unassigned" is never read as "assigned"', async () => {
    const { uberCourierState, uberCourierDetails } = await import('../lib/foodhub/courier');
    expect(uberCourierState('UNASSIGNED')).toBe('unassigned');
    expect(uberCourierState('EN_ROUTE_TO_PICKUP')).toBe('assigned');
    expect(uberCourierState('ARRIVED_AT_PICKUP')).toBe('at_store');
    expect(uberCourierState('EN_ROUTE_TO_DROPOFF')).toBe('picked_up');
    expect(uberCourierState('COMPLETED')).toBe('delivered');
    expect(uberCourierState('something new')).toBeNull();
    // Uber v2 order: courier fields directly on deliveries[0]
    const d = uberCourierDetails({ deliveries: [{ first_name: 'Marc', phone: '+15145550123', vehicle: { make: 'Honda', model: 'Civic', color: 'Grey' }, current_state: 'ARRIVED_AT_PICKUP' }] });
    expect(d).toMatchObject({ status: 'at_store', name: 'Marc', phone: '+15145550123', vehicle: 'Grey Honda Civic' });
  });
});
