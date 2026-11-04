// Direct Clover transaction boundaries: real Food Hub consumers/store, simulated provider and printer only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DirectOrder } from '../lib/foodhub/delivery/types';

type AtomicOutcome = 'ok' | 'lost_response' | 'server_error' | 'rejected';
const h = vi.hoisted(() => ({
  outcomes: [] as AtomicOutcome[],
  attempts: 0,
  providerOrders: [] as Array<{ id: string; body: unknown }>,
  prints: [] as string[],
  printOutcome: 'ok' as 'ok' | 'throw' | 'failure',
}));
vi.mock('../lib/foodhub/pos/clover-order', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover-order')>()),
  printKitchenTicket: vi.fn(async (id: string) => {
    h.prints.push(id);
    if (h.printOutcome === 'throw') throw new Error('Synthetic lost printer response');
    return h.printOutcome === 'failure' ? { ok: false, message: 'Synthetic printer outcome unknown' } : { ok: true, message: 'Synthetic ticket confirmed' };
  }),
}));
vi.mock('../lib/foodhub/notify', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/notify')>()),
  sendSms: vi.fn(async () => ({ ok: true, channel: 'sms', message: 'Synthetic text' })),
  postToChat: vi.fn(async () => ({ ok: true, channel: 'chat', message: 'Synthetic team message' })),
}));

import { createDirectOrderInClover } from '../lib/foodhub/delivery/clover-direct';
import { createDirectOrder, runDirectAction } from '../lib/foodhub/delivery/orders';
import { DIRECT_ORDERS, findDirectOrderBySource, getDirectOrder } from '../lib/foodhub/delivery/store';
import { allDayWeek, saveHours } from '../lib/foodhub/hours';
import { getRepo } from '../lib/foodhub/repo';

const MID = 'LOCALDIRECT01';
const actor = { username: 'test', name: 'Synthetic operator', source: 'api' as const };
const make = (sourceRef: string) => createDirectOrder({
  source: 'website', sourceRef, brandName: 'Pi Pita', locationCode: 'NDG_MAIN',
  customer: { name: 'Synthetic customer', phone: '+15145550101', lang: 'en' },
  fulfillment: 'pickup', payment: 'pay_at_pickup',
  lines: [{ name: 'Pita', quantity: 1, unitPrice: 10, total: 10, modifiers: [] }],
}, actor);

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.parse('2026-11-04T18:00:00Z'));
  vi.stubEnv('FOODHUB_FORCE_MEMORY', 'true');
  vi.stubEnv('FOODHUB_MEV', 'off');
  vi.stubEnv('FOODHUB_POS_INJECTION', 'on');
  vi.stubEnv('FOODHUB_CLOVER_AUTOPRINT', 'true');
  vi.stubEnv('FOODHUB_CLOVER_NO_REGISTER', '');
  vi.stubEnv('CLOVER_BASE_URL', 'https://direct-clover.example.test');
  vi.stubEnv('CLOVER_MERCHANT_ID', MID);
  vi.stubEnv('CLOVER_ACCESS_TOKEN', 'synthetic-rest-token');
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', '{}');
  vi.stubEnv('CLOVER_CLIENT_ID', ''); vi.stubEnv('CLOVER_CLIENT_SECRET', '');
  (globalThis as unknown as { __foodhubMem?: unknown }).__foodhubMem = undefined;
  h.outcomes = []; h.attempts = 0; h.providerOrders = []; h.prints = []; h.printOutcome = 'ok';
  vi.clearAllMocks();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(input));
    if (url.hostname !== 'direct-clover.example.test') throw new Error('Outbound call prohibited in direct Clover tests');
    if (url.pathname.endsWith('/order_types')) return Response.json({ elements: [] });
    if (url.pathname.endsWith('/atomic_order/orders') && init.method === 'POST') {
      h.attempts++;
      const outcome = h.outcomes.shift() ?? 'ok';
      if (outcome === 'rejected') return Response.json({ message: 'Synthetic definitive validation rejection' }, { status: 400 });
      const id = `CLV-${h.providerOrders.length + 1}`;
      h.providerOrders.push({ id, body: JSON.parse(String(init.body)) });
      if (outcome === 'lost_response') throw Object.assign(new Error('Synthetic connection reset after provider commit'), { cause: { code: 'ECONNRESET' } });
      if (outcome === 'server_error') return Response.json({ message: 'Synthetic response failed after provider commit' }, { status: 503 });
      return Response.json({ id });
    }
    if (url.pathname.endsWith('/orders')) return Response.json({ elements: h.providerOrders });
    throw new Error(`Unexpected simulated Clover request: ${init.method ?? 'GET'} ${url.pathname}`);
  }));
  await saveHours({ locations: { NDG_MAIN: allDayWeek() }, brands: {}, holidays: [] });
  await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'direct-clover-safety', brandName: 'Pi Pita', locationCode: 'NDG_MAIN', cloverMerchantId: MID, autoAccept: false, online: true, meta: {} });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('direct Clover unknown outcomes and recovery', () => {
  it.each(['lost_response', 'server_error'] as const)('never creates a second provider order after %s, including staff retries', async (outcome) => {
    h.outcomes = [outcome];
    const o = await make(`unknown-${outcome}`);
    expect(h.providerOrders).toHaveLength(1);
    expect(o.posOrderId).toBeUndefined();
    expect(o.posError).toBeTruthy();
    expect(o.attention).toBeTruthy();
    for (let n = 0; n < 2; n++) {
      const retry = await runDirectAction(o.id, 'retry_clover', actor);
      expect(retry.posOrderId).toBeUndefined();
      expect(retry.attention).toBeTruthy();
    }
    expect(h.attempts).toBe(1);
    expect(h.providerOrders).toHaveLength(1);
    expect(h.prints).toHaveLength(0);
  });

  it('recovers the persisted provider id after the final Food Hub write is lost without another create or print', async () => {
    const repo = getRepo(), put = repo.putDocs.bind(repo);
    let failed = false;
    const fault = vi.spyOn(repo, 'putDocs').mockImplementation(async (collection, docs) => {
      if (!failed && collection === DIRECT_ORDERS && docs.some((doc) => (doc.data as DirectOrder).sourceRef === 'final-write-lost' && (doc.data as DirectOrder).posOrderId === 'CLV-1')) {
        failed = true; throw new Error('Synthetic final Food Hub order write lost');
      }
      return put(collection, docs);
    });
    await expect(make('final-write-lost')).rejects.toThrow('Synthetic final Food Hub');
    fault.mockRestore();
    const pending = (await findDirectOrderBySource('website', 'final-write-lost'))!;
    expect(pending.posOrderId).toBeUndefined();
    expect(h.providerOrders).toHaveLength(1); expect(h.prints).toEqual(['CLV-1']);
    // Replay is recovery of existing work, including after configuration is disabled.
    vi.stubEnv('FOODHUB_POS_INJECTION', 'off'); vi.stubEnv('CLOVER_ACCESS_TOKEN', '');
    const recovered = await runDirectAction(pending.id, 'retry_clover', actor);
    expect(recovered.posOrderId).toBe('CLV-1');
    expect(recovered.status).toBe('in_kitchen');
    expect(h.attempts).toBe(1); expect(h.prints).toEqual(['CLV-1']);
  });

  it.each(['throw', 'failure'] as const)('retains the known Clover id with explicit print review when the printer returns %s', async (outcome) => {
    h.printOutcome = outcome;
    const o = await make(`print-${outcome}`);
    expect(o.posOrderId).toBe('CLV-1');
    expect(o.attention).toMatch(/print|imprim|billet|ticket/i);
    expect(h.prints).toEqual(['CLV-1']);
    const replay = await createDirectOrderInClover(o);
    expect(replay).toMatchObject({ ok: true, posOrderId: 'CLV-1', printReview: expect.any(String) });
    await expect(runDirectAction(o.id, 'retry_clover', actor)).rejects.toThrow(/already.*Clover/i);
    expect((await getDirectOrder(o.id))!.attention).toBeTruthy();
    expect(h.attempts).toBe(1); expect(h.prints).toEqual(['CLV-1']);
  });

  it('does not repeat a print whose successful response could not be durably recorded', async () => {
    const repo = getRepo(), write = repo.setKv.bind(repo);
    let failed = false;
    const fault = vi.spyOn(repo, 'setKv').mockImplementation(async (key, value) => {
      if (!failed && key.startsWith('direct_clover:') && (value as { printState?: string }).printState === 'sent') { failed = true; throw new Error('Synthetic print receipt write lost'); }
      return write(key, value);
    });
    const o = await make('print-receipt-lost');
    fault.mockRestore();
    expect(failed).toBe(true);
    expect(o.posOrderId).toBe('CLV-1'); expect(o.attention).toMatch(/print|imprim|billet|ticket/i);
    expect(await createDirectOrderInClover(o)).toMatchObject({ ok: true, posOrderId: 'CLV-1', printReview: expect.any(String) });
    expect(h.attempts).toBe(1); expect(h.prints).toEqual(['CLV-1']);
  });

  it('allows a genuine retry after a definitive rejected request which created no provider order', async () => {
    h.outcomes = ['rejected', 'ok'];
    const refused = await make('definitive-rejection');
    expect(refused.posError).toBeTruthy(); expect(h.providerOrders).toHaveLength(0);
    const retry = await runDirectAction(refused.id, 'retry_clover', actor);
    expect(retry.posOrderId).toBe('CLV-1'); expect(retry.status).toBe('in_kitchen');
    expect(h.attempts).toBe(2); expect(h.providerOrders).toHaveLength(1); expect(h.prints).toHaveLength(1);
  });

  it('allows retry after a pre-send credential failure without consuming an uncertain provider attempt', async () => {
    vi.stubEnv('CLOVER_ACCESS_TOKEN', '');
    const refused = await make('pre-send-failure');
    expect(refused.posError).toBeTruthy(); expect(h.attempts).toBe(0);
    vi.stubEnv('CLOVER_ACCESS_TOKEN', 'synthetic-rest-token');
    const retry = await runDirectAction(refused.id, 'retry_clover', actor);
    expect(retry.posOrderId).toBe('CLV-1');
    expect(h.attempts).toBe(1); expect(h.providerOrders).toHaveLength(1);
  });

  it('fails closed before the provider call when the durable attempt lookup is unavailable', async () => {
    const repo = getRepo(), read = repo.getKv.bind(repo);
    const fault = vi.spyOn(repo, 'getKv').mockImplementation((key) => key.startsWith('direct_clover:') ? Promise.reject(new Error('Synthetic attempt lookup unavailable')) : read(key));
    await make('attempt-lookup-outage').catch(() => undefined);
    fault.mockRestore();
    expect(h.attempts).toBe(0); expect(h.providerOrders).toHaveLength(0); expect(h.prints).toHaveLength(0);
  });
});
