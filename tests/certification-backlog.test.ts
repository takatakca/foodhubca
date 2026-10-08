// Certification backlog (task 13): docs/PLATFORM_API_RESEARCH.md §6, each field checked on the official docs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOORDASH_ERROR_CODES, doorDashAdapter, doorDashFailure, doorDashUserAgent, rejectReasonOf } from '../lib/foodhub/adapters/doordash';
import type { StoredOrder } from '../lib/foodhub/types';

type Call = { url: string; method: string; body: any; headers: Record<string, string> };
const calls: Call[] = [];
function mockFetch(route: (c: Call) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? init.body : null;
    let body: any = raw;
    try { body = raw ? JSON.parse(raw) : null; } catch { /* form body */ }
    const c: Call = { url, method: init.method || 'GET', body, headers: { ...(init.headers as Record<string, string> | undefined) } };
    calls.push(c);
    const r = route(c);
    return new Response(r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }));
}

const ENV_KEYS = ['DOORDASH_DEVELOPER_ID', 'DOORDASH_KEY_ID', 'DOORDASH_SIGNING_SECRET', 'DOORDASH_PROVIDER_TYPE', 'DOORDASH_WEBHOOK_SECRET', 'DOORDASH_USER_AGENT', 'LIVE_CONNECTORS_GLOBAL_ENABLED'];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ENV_KEYS) saved[k] = process.env[k];
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function doorDashEnv() {
  process.env.DOORDASH_DEVELOPER_ID = 'dev'; process.env.DOORDASH_KEY_ID = 'kid'; process.env.DOORDASH_SIGNING_SECRET = 'c2VjcmV0';
  process.env.DOORDASH_PROVIDER_TYPE = 'takatak_sandbox'; process.env.DOORDASH_WEBHOOK_SECRET = 'dd-secret';
  process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
  delete process.env.DOORDASH_USER_AGENT;
}

describe('DoorDash User-Agent (<ProviderType in CamelCase>/1.0)', () => {
  it('turns the snake_case provider type into the documented CamelCase form', () => {
    expect(doorDashUserAgent('merchant_sandbox', '')).toBe('MerchantSandbox/1.0'); // DoorDash's own example
    expect(doorDashUserAgent('takatak', '')).toBe('Takatak/1.0');
    expect(doorDashUserAgent('', '')).toBeNull();
    expect(doorDashUserAgent('doordash_pizza', 'DoorDashPizza/1.0')).toBe('DoorDashPizza/1.0'); // exact spelling override
  });

  it('is sent on every Marketplace call, with the JWT and auth-version headers', async () => {
    doorDashEnv();
    mockFetch(() => ({ status: 200, body: {} }));
    await doorDashAdapter.markReady({ externalOrderId: 'dd-1', id: 'o1' } as StoredOrder);
    expect(calls[0].headers['User-Agent']).toBe('TakatakSandbox/1.0');
    expect(calls[0].headers['auth-version']).toBe('v2');
    expect(calls[0].headers.Authorization).toMatch(/^Bearer /);
  });
});

describe('DoorDash reject: documented failure_reason strings + item-level errors[]', () => {
  const line = (externalId: string, name: string, mods: Array<[string, string]> = []) => ({ externalId, name, quantity: 1, unitPrice: 5, total: 5, modifiers: mods.map(([id, n]) => ({ externalId: id, name: n, quantity: 1, unitPrice: 0 })) });
  const order = { brandName: 'Pi Pita', placedAt: '2026-10-07T18:30:00Z', lines: [line('i1', 'Poutine'), line('i2', 'Shawarma', [['m1', 'Extra garlic']])] };

  it('reads the reject pop-up text (label — details) and free text', () => {
    expect(rejectReasonOf('Item out of stock — Poutine')).toEqual({ reason: 'out_of_stock', details: 'Poutine' });
    expect(rejectReasonOf('Kitchen too busy')).toEqual({ reason: 'too_busy', details: '' });
    expect(rejectReasonOf('Clover did not receive the order').reason).toBe('pos_issue');
    expect(rejectReasonOf('Rejected by restaurant').reason).toBe('other');
  });

  it('out of stock: names the item (and option) and sends one ITEM_OUT_OF_STOCK error per id', () => {
    const f = doorDashFailure(order, 'Item out of stock — no more poutine, extra garlic');
    expect(f.failure_reason).toBe('Item Unavailable - Poutine - i1 - Out of stock; Item Unavailable - Extra garlic - m1 - Out of stock');
    expect(f.errors).toEqual([
      { code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i1', message: 'Item Unavailable - Poutine - Out of stock' },
      { code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'm1', message: 'Item Unavailable - Extra garlic - Out of stock' },
    ]);
    for (const e of f.errors!) expect(DOORDASH_ERROR_CODES).toContain(e.code);
    // 86'd at the location → found without being named
    expect(doorDashFailure(order, 'Item out of stock', new Set(['i2'])).errors?.map((e) => e.merchant_supplied_id)).toEqual(['i2']);
    // one-line order → that line
    expect(doorDashFailure({ ...order, lines: [line('i9', 'Falafel')] }, 'Item out of stock').errors?.[0].merchant_supplied_id).toBe('i9');
    // nothing identifiable → still the documented category, never empty
    expect(doorDashFailure(order, 'Item out of stock')).toEqual({ failure_reason: 'Item Unavailable - Out of stock' });
  });

  it('store-level reasons use DoorDash’s documented strings (no errors[])', () => {
    expect(doorDashFailure(order, 'Store / kitchen closed')).toEqual({ failure_reason: 'Store is either currently closed or your order cannot be prepared prior to close.' });
    expect(doorDashFailure(order, 'Kitchen too busy').failure_reason).toMatch(/^Pi Pita is experiencing high order volume and cannot prepare your order for \d\d:\d\d$/);
    expect(doorDashFailure(order, 'POS / Clover problem')).toEqual({ failure_reason: 'POS Exception - Store is offline' });
    expect(doorDashFailure(order, 'Other — allergy we cannot handle').failure_reason).toBe('Rejected by the restaurant: allergy we cannot handle');
    expect(doorDashFailure(order, 'Other').failure_reason).toBe('Rejected by the restaurant (reason not given)');
  });

  it('denyOrder PATCHes order_status fail with the failure body, using the location’s 86 list', async () => {
    doorDashEnv();
    const { getRepo } = await import('../lib/foodhub/repo');
    await getRepo().saveMenu({ brandName: 'Pi Pita', categories: [], items: [], modifierGroups: [], unavailableByLocation: { NDG: ['i2'] }, updatedAt: 'x' });
    mockFetch(() => ({ status: 200, body: {} }));
    const res = await doorDashAdapter.denyOrder({ ...order, id: 'o1', externalOrderId: 'dd-9', locationCode: 'NDG' } as unknown as StoredOrder, 'Item out of stock');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toMatch(/\/api\/v1\/orders\/dd-9$/);
    expect(calls[0].body).toEqual({ merchant_supplied_id: 'o1', order_status: 'fail', failure_reason: 'Item Unavailable - Shawarma - i2 - Out of stock', errors: [{ code: 'ITEM_OUT_OF_STOCK', merchant_supplied_id: 'i2', message: 'Item Unavailable - Shawarma - Out of stock' }] });
  });
});
