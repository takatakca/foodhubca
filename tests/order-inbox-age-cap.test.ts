// Regression (PR #6 review): relay / TGTG orders have no platform deadline (deadlineFor → null), so the recovery sweep has no age
// limit for them. A relay order whose live run died at closing time is put in Clover (kitchen ticket) and acknowledged
// to the partner whenever the next sync runs — the next morning on a Vercel daily cron, or hours later after an outage.
// The sweep's own rule ("past the answer window a person checks first — a late Clover ticket could cook it twice")
// never applies to these orders.
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

import { INBOX, inboxId, sweepOrderInbox, type InboxRecord } from '../lib/foodhub/inbox';
import { getRepo } from '../lib/foodhub/repo';

const RELAY = 'http://hub.local/api/foodhub/webhooks/relay?token=relay-secret-token-1234567890';
const realFetch = globalThis.fetch;
const relayOrder = (id: number) => ({
  customer: { name: 'Ana B.', phone: '5145550000' },
  order: {
    details: { id, channel: 'tgtg', created: Date.now() - 60_000, order_type: 'pickup', order_subtotal: 5.99, order_total: 5.99, total_taxes: 0, brand: { name: 'Po Poulet' } },
    items: [{ id: 1, title: 'Panier surprise', price: 5.99, quantity: 1, total: 5.99 }],
    store: { id: 1712, merchant_ref_id: '182304', name: 'NDG' },
  },
});

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

describe('recovery of orders without a platform deadline', () => {
  it('a relay order left queued 12 hours ago is handed to a person, not printed in the kitchen', async () => {
    injectMock.mockResolvedValue({ ok: true, posOrderId: 'CLV-1' });
    ctl.mode = 'drop'; // the live run died (restart / function timeout at closing time)
    const { POST } = await import('../app/api/foodhub/webhooks/relay/route');
    expect((await POST(new Request(RELAY, { method: 'POST', body: JSON.stringify(relayOrder(8201)) }) as any)).status).toBe(200);
    ctl.mode = 'run';

    // First sync after the night (Vercel cron "0 9 * * *", or the first dashboard opened in the morning).
    const out = await sweepOrderInbox({ now: Date.now() + 12 * 3600_000 });
    // Before the fix: recovered=1, the 12-hour-old order is injected into Clover (kitchen ticket printed).
    expect(injectMock).not.toHaveBeenCalled();
    expect(out).toMatchObject({ recovered: 0, failed: 1 });
    expect((await getRepo().getDoc<InboxRecord>(INBOX, inboxId('tgtg', 'relay-8201')))?.data.status).toBe('error');
  });
});
