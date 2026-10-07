// Regression (PR #6 review): a relay order is saved in the inbox (sender got its 200) but not processed yet (server restart, or the
// live run still before insertOrderIfNew). The partner then cancels it. The relay status route only looks in
// fh_orders, finds nothing and keeps the cancel as an "unparsed payload" — it is NOT parked as a pending platform
// status (DoorDash / Uber / Skip cancels are, via applyExternalStatus). The recovery sweep then processes the order:
// Clover ticket in the kitchen and "Acknowledged" pushed to the partner for an order the customer cancelled.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ctl = vi.hoisted(() => ({ mode: 'run' as 'run' | 'drop' }));
vi.mock('next/server', async (orig) => ({
  ...(await orig<typeof import('next/server')>()),
  after: (fn: () => unknown) => { if (ctl.mode === 'run') void Promise.resolve().then(fn); },
}));
const injectMock = vi.fn();
vi.mock('../lib/foodhub/pos/clover', async (orig) => ({
  ...(await orig<typeof import('../lib/foodhub/pos/clover')>()),
  cloverInjectionEnabled: () => true,
  cloverExpected: () => true,
  allCloverMerchants: async () => ['M1'],
  injectOrder: (...args: unknown[]) => injectMock(...args),
  printCloverOrder: async () => ({ ok: true, message: 'printed' }),
}));

import { INBOX_STALE_MS, sweepOrderInbox } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const RELAY = 'http://hub.local/api/foodhub/webhooks/relay?token=relay-secret-token-1234567890';
const realFetch = globalThis.fetch;
const settle = () => new Promise((r) => setTimeout(r, 30));
const relayOrder = (id: number) => ({
  customer: { name: 'Ana B.', phone: '5145550000' },
  order: {
    details: { id, channel: 'tgtg', created: Date.now() - 60_000, order_type: 'pickup', order_subtotal: 5.99, order_total: 5.99, total_taxes: 0, brand: { name: 'Po Poulet' } },
    items: [{ id: 1, title: 'Panier surprise', price: 5.99, quantity: 1, total: 5.99 }],
    store: { id: 1712, merchant_ref_id: '182304', name: 'NDG' },
  },
});
async function post(body: unknown) {
  const { POST } = await import('../app/api/foodhub/webhooks/relay/route');
  return POST(new Request(RELAY, { method: 'POST', body: JSON.stringify(body) }) as any);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_RELAY_SECRET = 'relay-secret-token-1234567890';
  process.env.FOODHUB_RELAY_CHANNELS = 'tgtg';
  ctl.mode = 'run';
  injectMock.mockReset();
  globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as any;
});
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); delete process.env.FOODHUB_RELAY_SECRET; delete process.env.FOODHUB_RELAY_CHANNELS; });

describe('relay cancel for an order still in the order inbox', () => {
  it('is applied when the inbox order is processed: no Clover ticket, order cancelled', async () => {
    injectMock.mockResolvedValue({ ok: true, posOrderId: 'CLV-1' });
    ctl.mode = 'drop'; // the server stopped between the 200 and the pipeline
    expect((await post(relayOrder(8101))).status).toBe(200);
    ctl.mode = 'run';

    // The customer cancels on the partner side; the partner relays it (200, kept as "unparsed").
    expect((await post({ order_id: 8101, new_state: 'customer_cancelled', message: 'Customer cancelled', additional_info: { external_channel: { name: 'tgtg' } } })).status).toBe(200);
    await settle();

    // Next sync after the restart: the inbox sweep processes the saved order.
    expect(await sweepOrderInbox({ now: Date.now() + INBOX_STALE_MS + 30_000 })).toMatchObject({ recovered: 1 });
    const [o] = (await getRepo().listOrders()).filter((x) => x.externalOrderId === 'relay-8101');
    // Before the fix: the cancelled order is put in Clover (kitchen ticket) and left open as 'new'.
    expect(injectMock).not.toHaveBeenCalled();
    expect(o.status).toBe('cancelled');
  });
});
