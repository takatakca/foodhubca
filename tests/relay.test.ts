// Orders pushed to the Food Hub Order Relay (TGTG feed, website…): parsed, run through the pipeline, and
// accept/ready go back to the relay callback only when one is set and live connectors are on — never shown as sent otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isRelayStore, parseRelayOrder, parseRelayStatus, relayActions, relayChannel, relayChannels, relayStatusApplies, relayTimeMs, verifyRelayWebhook } from '../lib/foodhub/adapters/relay';
import { processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';

// Run route background work (next/server after()) right away in tests.
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => { void Promise.resolve().then(fn); } }));

const realFetch = globalThis.fetch;
let calls: Array<{ url: string; init?: RequestInit }> = [];

function sample(channel = 'skipthedishes', id = 3444567) {
  return {
    customer: { name: 'Ana B.', phone: '5145550000', address: { line_1: '6280 Somerled' } },
    order: {
      details: {
        id, channel, created: Date.now() - 60_000, order_type: 'delivery', order_subtotal: 24, order_total: 27.6, total_taxes: 3.6, total_charges: 0, discount: 0,
        instructions: 'Sonnez svp', brand: { name: 'Po Poulet' },
        ext_platforms: [{ id: 'SKIP-998877', kind: 'food_aggregator', name: channel, delivery_type: 'partner' }],
      },
      items: [{
        id: 46898, merchant_id: 'clv-1', title: 'Poulet Grillé', price: 0, quantity: 2, total: 24, instructions: 'bien cuit',
        options_to_add: [{ id: 1, merchant_id: 'opt-1', title: 'Grand', price: 10, quantity: 1 }, { id: 2, title: 'Piri-piri', price: 2, quantity: 1 }],
        options_to_remove: [{ title: 'Oignons' }],
      }],
      store: { id: 1712, merchant_ref_id: '182304', name: 'NDG' },
      payment: [{ amount: 27.6, option: 'online' }],
    },
  };
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.FOODHUB_POS_INJECTION = 'off';
  // Most tests use relayed Skip orders: Skip is not on the relay by default, so list it explicitly.
  process.env.FOODHUB_RELAY_CHANNELS = 'skip,tgtg';
  delete process.env.FOODHUB_VIA_CLOVER;
  delete process.env.FOODHUB_RELAY_CALLBACK_URL;
  delete process.env.FOODHUB_RELAY_CALLBACK_TOKEN;
  delete process.env.LIVE_CONNECTORS_GLOBAL_ENABLED;
  process.env.FOODHUB_RELAY_SECRET = 'relay-secret-token-1234567890';
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('{"status":"success"}', { status: 200 });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.FOODHUB_POS_INJECTION; });

describe('orders through the Food Hub Order Relay', () => {
  it('recognises the platforms and checks the webhook token', () => {
    expect(relayChannel('SkipTheDishes')).toBe('skip');
    expect(relayChannel('doordash')).toBe('doordash');
    expect(relayChannel('ubereats')).toBe('uber_eats');
    expect(relayChannel('zomato')).toBeNull();
    expect(verifyRelayWebhook(new Headers(), new URL('https://x/api?token=relay-secret-token-1234567890'))).toBe(true);
    expect(verifyRelayWebhook(new Headers({ authorization: 'Bearer relay-secret-token-1234567890' }), new URL('https://x/api'))).toBe(true);
    expect(verifyRelayWebhook(new Headers(), new URL('https://x/api?token=wrong'))).toBe(false);
  });

  it('turns a relayed order into a Skip order with lines, options and removals', () => {
    const r = parseRelayOrder(sample());
    if ('ignored' in r) throw new Error(r.ignored);
    const o = r.order;
    expect(o).toMatchObject({ channel: 'skip', externalOrderId: 'relay-3444567', displayId: 'SKIP-998877', channelStoreId: 'relay:182304', viaHub: 'relay', hubOrderId: '3444567', total: 27.6, tax: 3.6, customerName: 'Ana B.', fulfillment: 'delivery' });
    expect(o.lines[0]).toMatchObject({ name: 'Poulet Grillé', quantity: 2, unitPrice: 12, total: 24, externalId: 'clv-1' });
    expect(o.lines[0].modifiers.map((m) => m.name)).toEqual(['Grand', 'Piri-piri']);
    expect(o.lines[0].notes).toContain('Sans Oignons');
  });

  it('ignores platforms not taken from the relay', () => {
    expect('ignored' in parseRelayOrder(sample('ubereats'))).toBe(true);
    process.env.FOODHUB_RELAY_CHANNELS = '';
    expect(relayChannels()).toEqual(['tgtg']);
    process.env.FOODHUB_RELAY_CHANNELS = 'skip,doordash';
    process.env.FOODHUB_VIA_CLOVER = 'doordash';
    expect(relayChannels()).toEqual(['skip']);
    expect(parseRelayOrder(sample('doordash'))).toMatchObject({ channel: 'doordash', ignored: expect.stringMatching(/linked through Clover/) });
    delete process.env.FOODHUB_VIA_CLOVER;
    process.env.FOODHUB_RELAY_CHANNELS = 'skip,doordash,uber_eats';
    expect('ignored' in parseRelayOrder(sample('ubereats'))).toBe(false);
    expect('ignored' in parseRelayOrder(sample('zomato'))).toBe(true);
  });

  it('without a callback address, accept is not sent and says so', async () => {
    const r = parseRelayOrder(sample()) as any;
    const out = await processIncomingOrder(r.order);
    expect(out.accept?.status).toBe('skipped');
    expect(out.accept?.message).toMatch(/Not sent to Skip/);
    expect(calls).toEqual([]);
  });

  it('with a callback address, accept and ready are posted back', async () => {
    process.env.FOODHUB_RELAY_CHANNELS = 'skip,tgtg';
    process.env.FOODHUB_RELAY_CALLBACK_URL = 'https://partner.example/foodhub/status';
    process.env.FOODHUB_RELAY_CALLBACK_TOKEN = 'cb-token';
    process.env.LIVE_CONNECTORS_GLOBAL_ENABLED = 'true';
    process.env.FOODHUB_AUTO_ACCEPT_DEFAULT = 'false';
    const r = parseRelayOrder(sample('tgtg', 555)) as any;
    const { order } = await processIncomingOrder(r.order);
    // Clover injection is off here, so the locked rule asks for the explicit "Accept without Clover".
    const acc = await runOrderAction(order.id, 'accept_no_pos');
    expect(acc.result.ok).toBe(true);
    const put = calls.find((c) => c.url === 'https://partner.example/foodhub/status')!;
    expect(put.init?.method).toBe('POST');
    expect((put.init?.headers as any).Authorization).toBe('Bearer cb-token');
    expect(JSON.parse(String(put.init?.body))).toMatchObject({ order_id: '555', channel: 'tgtg', new_status: 'Acknowledged' });
    await runOrderAction(order.id, 'ready');
    expect(JSON.parse(String(calls.at(-1)!.init?.body)).new_status).toBe('Food Ready');
    delete process.env.FOODHUB_AUTO_ACCEPT_DEFAULT;
  });

  it('takes only TGTG by default, never DoorDash (connected directly), and sends nothing while live connectors are off', async () => {
    delete process.env.FOODHUB_RELAY_CHANNELS;
    expect('ignored' in parseRelayOrder(sample())).toBe(true);
    expect('ignored' in parseRelayOrder(sample('tgtg'))).toBe(false);
    expect('ignored' in parseRelayOrder(sample('doordash'))).toBe(true);
    process.env.FOODHUB_RELAY_CALLBACK_URL = 'https://partner.example/foodhub/status';
    const out = await processIncomingOrder((parseRelayOrder(sample('tgtg', 777)) as any).order);
    expect(out.accept?.status).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('never offers Skip "report missing items" on a relayed Skip order (Skip’s API does not know it)', async () => {
    const { allowedActions } = await import('../lib/foodhub/pipeline');
    const out = await processIncomingOrder((parseRelayOrder(sample()) as any).order);
    expect(allowedActions({ ...out.order, status: 'accepted' })).not.toContain('report_missing');
    expect(allowedActions({ ...out.order, status: 'accepted', viaHub: undefined })).toContain('report_missing');
  });

  it('refuses reject / cancel when no callback address is set (the partner order would stay live)', async () => {
    const out = await processIncomingOrder((parseRelayOrder(sample('tgtg', 901)) as any).order);
    const res = await relayActions.denyOrder(out.order, 'Out of stock');
    expect(res).toMatchObject({ ok: false, status: 'blocked' });
    expect((await relayActions.cancelOrder(out.order, 'other')).ok).toBe(false);
    expect((await relayActions.markReady(out.order)).status).toBe('skipped');
    expect(calls).toEqual([]);
  });

  it('survives malformed payloads and reads ISO / epoch-second timestamps', () => {
    const bad = sample('tgtg', 902) as any;
    bad.order.items = [null, { title: 'Bag', quantity: 1, total: 5.99, options_to_add: [null], options_to_remove: [null] }];
    bad.order.details.created = 1e17;
    bad.order.details.expected_pickup_time = '2026-10-06T18:00:00Z';
    const r = parseRelayOrder(bad);
    if ('ignored' in r) throw new Error(r.ignored);
    expect(r.order.lines).toHaveLength(1);
    expect(r.order.readyBy).toBe('2026-10-06T18:00:00.000Z');
    expect(Date.parse(r.order.placedAt)).toBeGreaterThan(Date.parse('2026-01-01'));
    expect(relayTimeMs(1760000000)).toBe(1760000000000);
    expect(relayTimeMs('2026')).toBeUndefined();
    const noId = sample('tgtg') as any; noId.order.details.id = null;
    expect('ignored' in parseRelayOrder(noId)).toBe(true);
  });

  it('keeps an ignored relay order as unparsed instead of dropping it', async () => {
    const { POST } = await import('../app/api/foodhub/webhooks/relay/route');
    const req = new Request('http://hub.local/api/foodhub/webhooks/relay?token=relay-secret-token-1234567890', { method: 'POST', body: JSON.stringify(sample('zomato', 903)) });
    const res = await POST(req as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 'unparsed' });
    await new Promise((r) => setTimeout(r, 20));
    const { getRepo } = await import('../lib/foodhub/repo');
    expect((await getRepo().listJobs(50)).some((j) => j.kind === 'webhook_unparsed')).toBe(true);
  });

  it('applies relayed statuses forward only and never reopens a closed order', () => {
    expect(relayStatusApplies({ status: 'ready' }, 'Acknowledged')).toBe(false);
    expect(relayStatusApplies({ status: 'accepted' }, 'Food Ready')).toBe(true);
    expect(relayStatusApplies({ status: 'cancelled' }, 'Completed')).toBe(false);
    expect(relayStatusApplies({ status: 'completed' }, 'Cancelled')).toBe(false);
    expect(relayStatusApplies({ status: 'ready' }, 'customer_cancelled')).toBe(true);
    expect(relayStatusApplies({ status: 'new' }, 'Acknowledged', { needsClover: true })).toBe(false);
    expect(relayStatusApplies({ status: 'new' }, 'Acknowledged')).toBe(true);
  });

  it('relay-mapped stores get orders only — no menu, 86 or pause goes to the platform API', async () => {
    const { getRepo } = await import('../lib/foodhub/repo');
    const { storesFor } = await import('../lib/foodhub/ops');
    await getRepo().upsertStore({ channel: 'skip', channelStoreId: 'relay:182304', brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    await getRepo().upsertStore({ channel: 'skip', channelStoreId: 'jet-1', brandName: 'Po Poulet', locationCode: 'NDG', autoAccept: true, online: true, meta: {} });
    expect(isRelayStore({ channelStoreId: 'relay:182304' })).toBe(true);
    expect((await storesFor({ brandName: 'Po Poulet' })).map((s) => s.channelStoreId)).toEqual(['jet-1']);
  });

  it('reads relayed status changes (customer cancelled)', async () => {
    const s = parseRelayStatus({ order_id: 3444567, new_state: 'customer_cancelled', additional_info: { external_channel: { name: 'SkipTheDishes', order_id: 'SKIP-998877' } }, message: 'Wrong address' });
    expect(s).toEqual({ channel: 'skip', externalOrderId: 'relay-3444567', state: 'customer_cancelled', message: 'Wrong address' });
    expect(parseRelayStatus({ order_id: 1, new_state: 'x', additional_info: { external_channel: { name: 'zomato' } } })).toBeNull();
    expect(typeof relayActions.markReady).toBe('function');
    expect(getRepo()).toBeTruthy();
  });
});
