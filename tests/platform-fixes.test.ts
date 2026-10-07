// DoorDash / Uber Eats behaviour checked against the documented API shapes (platform audit, 2026-10-06).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateUberToken, uberEatsAdapter } from '../lib/foodhub/adapters/uber-eats';
import { callApi } from '../lib/foodhub/config';
import { doorDashCourierStatus } from '../lib/foodhub/courier';
import { doorDashIntervals } from '../lib/foodhub/menu/translate';
import { normalizeWeek } from '../lib/foodhub/hours';
import { getRepo } from '../lib/foodhub/repo';
import type { ChannelStore, MasterMenu, StoredOrder, WeeklyHours } from '../lib/foodhub/types';

// Route background work (next/server after()) runs right away in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

type Call = { url: string; method: string; body: any; auth: string | null };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const h = init.headers as Record<string, string> | undefined;
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url, method: init.method || 'GET', body, auth: h?.Authorization ?? null };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}
const settle = () => new Promise((r) => setTimeout(r, 30));
const week = (open: string, close: string, days: string[]): WeeklyHours =>
  Object.fromEntries(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => [d, days.includes(d) ? [{ open, close }] : []])) as WeeklyHours;

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
});
afterEach(() => vi.unstubAllGlobals());

describe('DoorDash', () => {
  it('maps the documented dasher_status values', () => {
    expect(doorDashCourierStatus('dasher_confirmed')).toBe('assigned');
    expect(doorDashCourierStatus('arriving_at_store')).toBe('arriving');
    expect(doorDashCourierStatus('arrived_at_store')).toBe('at_store');
    expect(doorDashCourierStatus('dasher_out_for_delivery')).toBe('picked_up');
    expect(doorDashCourierStatus('dropoff')).toBe('delivered');
    expect(doorDashCourierStatus('dasher_status_update')).toBeNull();
  });

  it('sends overnight hours as one interval (no 23:39 cut-off) and a real midnight close as 23:59:59', () => {
    expect(doorDashIntervals(normalizeWeek(week('18:00', '02:00', ['monday'])))).toEqual([{ day: 'monday', start_time: '18:00:00', end_time: '02:00:00' }]);
    expect(doorDashIntervals(normalizeWeek(week('22:00', '03:00', ['sunday'])))).toEqual([{ day: 'sunday', start_time: '22:00:00', end_time: '03:00:00' }]);
    const allDay = doorDashIntervals(normalizeWeek(week('00:00', '23:59', ['monday', 'tuesday'])));
    expect(allDay).toEqual([{ day: 'monday', start_time: '00:00:00', end_time: '23:59:59' }, { day: 'tuesday', start_time: '00:00:00', end_time: '23:59:59' }]);
    expect(doorDashIntervals(normalizeWeek(week('11:00', '22:00', ['monday'])))).toEqual([{ day: 'monday', start_time: '11:00:00', end_time: '22:00:00' }]);
  });

  describe('webhooks (documented payloads)', () => {
    const hook = async (body: unknown) => {
      const { POST } = await import('../app/api/foodhub/webhooks/doordash/route');
      const res = await POST(new Request('http://hub.local/api/foodhub/webhooks/doordash', { method: 'POST', headers: { authorization: 'dd-secret' }, body: JSON.stringify(body) }) as any);
      await settle();
      return res;
    };
    beforeEach(() => { process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret'; process.env.FOODHUB_POS_INJECTION = 'off'; });
    const order = async (id: string) => (await getRepo().insertOrderIfNew({ channel: 'doordash', marketplace: 'doordash', externalOrderId: id, channelStoreId: 'dd-1', fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 10, tax: 1.5, deliveryFee: 0, tip: 0, discount: 0, total: 11.5, lines: [], raw: {} })).order as StoredOrder;

    it('Order Cancellation webhook cancels the order', async () => {
      const o = await order('0da8b530-7c4c-4925-8785-cd843b797d64');
      expect((await hook({ external_order_id: o.externalOrderId, client_order_id: '321', store: { provider_type: 'p', merchant_supplied_id: 'dd-1' }, is_asap: true })).status).toBe(200);
      expect((await getRepo().getOrder(o.id))?.status).toBe('cancelled');
    });

    it('Dasher status update (dasher_status field) reaches the order', async () => {
      const o = await order('dd-order-9');
      await hook({ event: { type: 'dasher_status_update' }, dasher_status: 'arriving_at_store', external_order_id: 'dd-order-9' });
      expect((await getRepo().getOrder(o.id))?.timeline?.courier?.status).toBe('arriving');
    });

    it('Menu Status (event.reference / event.status) closes the push job with DoorDash’s reason and keeps the menu id', async () => {
      const store = await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-1', brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
      const job = await getRepo().addJob({ kind: 'menu_push', channel: 'doordash', reference: 'ref-abc', status: 'queued', request: { storeId: store.id, channelStoreId: 'dd-1' }, result: {} });
      await hook({ event: { type: 'MenuCreate', status: 'FAILURE', reference: 'ref-abc', details: 'Item i9 has no price' }, menu: { id: 'menu-uuid-1' } });
      const after = (await getRepo().listJobs(10)).find((j) => j.id === job.id)!;
      expect(after.status).toBe('error');
      expect((after.result as { message?: string }).message).toMatch(/Item i9 has no price/);
      expect((await getRepo().getStore(store.id))?.meta.doordashMenuId).toBe('menu-uuid-1');
    });
  });
});

describe('DoorDash menu pull and merchant cancellation', () => {
  beforeEach(() => {
    process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret';
    process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
    process.env.DOORDASH_PROVIDER_TYPE = 'takatak'; process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    delete process.env.DOORDASH_MERCHANT_CANCEL;
  });

  it('Menu Request returns the store’s (shared) menu as an array with DoorDash’s menu id', async () => {
    const { GET } = await import('../app/api/foodhub/webhooks/doordash/menu/[locationId]/route');
    const { saveMenuSharing } = await import('../lib/foodhub/menu/shared');
    await getRepo().saveMenu({ brandName: 'Po Poulet', categories: [{ ref: 'c1', name: 'Plats', sortOrder: 0 }], items: [{ ref: 'i1', name: 'Poutine', price: 9.5, categoryRef: 'c1', available: true, modifierGroupRefs: [] }], modifierGroups: [], updatedAt: 'x' });
    await saveMenuSharing({ 'Pi Pita': 'Po Poulet' });
    await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-pita', brandName: 'Pi Pita', locationCode: 'NDG', autoAccept: true, online: true, meta: { doordashMenuId: 'menu-7' } });
    const get = (id: string, auth = 'dd-secret') => GET(new Request(`http://hub.local/api/foodhub/webhooks/doordash/menu/${id}`, { headers: { authorization: auth } }) as any, { params: Promise.resolve({ locationId: id }) });
    expect((await get('dd-pita', 'wrong')).status).toBe(401);
    expect((await get('nope')).status).toBe(404);
    const res = await get('dd-pita');
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toMatchObject({ id: 'menu-7', store: { merchant_supplied_id: 'dd-pita', provider_type: 'takatak' }, menu: { name: 'Pi Pita' } });
    expect(body[0].menu.categories[0].items[0].name).toBe('Poutine');
  });

  it('cancel is refused unless DoorDash allowlisted it; then PATCHes /cancellation with the mapped reason', async () => {
    const { doorDashAdapter } = await import('../lib/foodhub/adapters/doordash');
    const o = { externalOrderId: 'dd-o-1' } as StoredOrder;
    expect((await doorDashAdapter.cancelOrder(o, 'too_busy')).status).toBe('blocked');
    process.env.DOORDASH_MERCHANT_CANCEL = 'true';
    mockFetch(() => ({ status: 200, body: {} }));
    const ok = await doorDashAdapter.cancelOrder(o, 'too_busy', 'Rush');
    expect(calls[0]).toMatchObject({ method: 'PATCH', body: { cancel_reason: 'KITCHEN_BUSY', cancel_details: 'Rush' } });
    expect(calls[0].url).toMatch(/\/api\/v1\/orders\/dd-o-1\/cancellation$/);
    expect(ok.message).toMatch(/15 minutes/);
    mockFetch(() => ({ status: 403, body: { message: 'not allowlisted' } }));
    expect((await doorDashAdapter.cancelOrder(o, 'other')).status).toBe('blocked');
  });
});

describe('Uber Eats', () => {
  const store: ChannelStore = { id: 's1', channel: 'uber_eats', channelStoreId: 'uuid-1', brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} };
  beforeEach(() => {
    process.env.UBER_CLIENT_ID = 'id'; process.env.UBER_CLIENT_SECRET = 'secret';
    delete process.env.UBER_ACCESS_TOKEN; delete process.env.UBER_OAUTH_SCOPE;
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    invalidateUberToken();
  });

  it('accept sends pickup_time (Unix seconds) from the ready-by target', async () => {
    mockFetch((c) => (/oauth/.test(c.url) ? { status: 200, body: { access_token: 't' } } : { status: 204 }));
    const ready = Date.now() + 20 * 60_000;
    await uberEatsAdapter.acceptOrder({ externalOrderId: 'u-1', timeline: { readyTarget: new Date(ready).toISOString() } } as StoredOrder, 'clv-1');
    const accept = calls.find((c) => /accept_pos_order$/.test(c.url))!;
    expect(accept.body).toMatchObject({ external_reference_id: 'clv-1', pickup_time: Math.floor(ready / 1000) });
  });

  it('an 86 batch keeps going past a refused item and reports which ones failed', async () => {
    mockFetch((c) => (/oauth/.test(c.url) ? { status: 200, body: { access_token: 't' } } : /items\/a$/.test(c.url) ? { status: 404, body: { message: 'item not found' } } : { status: 204 }));
    const res = await uberEatsAdapter.setItemAvailability(store, ['a', 'b', 'c'], false);
    expect(calls.filter((c) => /menus\/items\//.test(c.url))).toHaveLength(3);
    expect(res).toMatchObject({ ok: false, status: 'error' });
    expect(res.message).toMatch(/1\/3 item\(s\) refused.*a.*item not found/);
  });

  it('without the separately-approved status scope, the token falls back so orders keep working', async () => {
    mockFetch((c) => {
      if (/oauth/.test(c.url)) return String(c.body).includes('status.write') ? { status: 400, body: { error: 'invalid_scope' } } : { status: 200, body: { access_token: 'orders-only' } };
      return { status: 204 };
    });
    const res = await uberEatsAdapter.acceptOrder({ externalOrderId: 'u-2', timeline: {} } as StoredOrder);
    expect(res.ok).toBe(true);
    expect(calls.find((c) => /accept_pos_order$/.test(c.url))?.auth).toBe('Bearer orders-only');
  });

  it('clears Uber holiday dates when every holiday was removed since the last publish', async () => {
    const saved = await getRepo().upsertStore({ ...store, id: undefined, meta: { uberHolidayDates: ['2026-12-25'] } });
    mockFetch((c) => (/oauth/.test(c.url) ? { status: 200, body: { access_token: 't' } } : { status: 204 }));
    const menu: MasterMenu = { brandName: 'Po Poulet', categories: [], items: [], modifierGroups: [], updatedAt: 'x' };
    const res = await uberEatsAdapter.publishMenu(saved, menu, { hours: null, holidays: [], language: 'en' } as never);
    expect(res.ok).toBe(true);
    expect(calls.find((c) => /holiday-hours$/.test(c.url))?.body).toEqual({ holiday_hours: {} });
    expect((await getRepo().getStore(saved.id))?.meta.uberHolidayDates).toEqual([]);
  });
});

describe('platform error messages', () => {
  it('say why the platform refused, not only the HTTP status', async () => {
    mockFetch(() => ({ status: 400, body: { message: 'open_hours[0].end_time is invalid' } }));
    const r = await callApi('doordash', 'https://openapi.doordash.com/marketplace/api/v1/menus', { method: 'POST' });
    expect(r.message).toBe('POST /marketplace/api/v1/menus returned HTTP 400: open_hours[0].end_time is invalid');
  });
});
