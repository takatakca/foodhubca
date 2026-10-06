// Orders pushed to the Food Hub Order Relay (TGTG feed, website…): parsed, run through the pipeline, and
// accept/ready go back to the relay callback only when one is set and live connectors are on — never shown as sent otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRelayOrder, parseRelayStatus, relayChannel, relayActions, verifyRelayWebhook } from '../lib/foodhub/adapters/relay';
import { processIncomingOrder, runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';

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
  delete process.env.FOODHUB_RELAY_CHANNELS;
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
    expect(o).toMatchObject({ channel: 'skip', externalOrderId: 'relay-3444567', displayId: 'SKIP-998877', channelStoreId: '182304', viaHub: 'relay', hubOrderId: '3444567', total: 27.6, tax: 3.6, customerName: 'Ana B.', fulfillment: 'delivery' });
    expect(o.lines[0]).toMatchObject({ name: 'Poulet Grillé', quantity: 2, unitPrice: 12, total: 24, externalId: 'clv-1' });
    expect(o.lines[0].modifiers.map((m) => m.name)).toEqual(['Grand', 'Piri-piri']);
    expect(o.lines[0].notes).toContain('Sans Oignons');
  });

  it('ignores platforms not taken from the relay', () => {
    expect('ignored' in parseRelayOrder(sample('ubereats'))).toBe(true);
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

  it('takes Skip and TGTG by default, never DoorDash (connected directly), and sends nothing while live connectors are off', async () => {
    expect('ignored' in parseRelayOrder(sample('tgtg'))).toBe(false);
    expect('ignored' in parseRelayOrder(sample('doordash'))).toBe(true);
    process.env.FOODHUB_RELAY_CALLBACK_URL = 'https://partner.example/foodhub/status';
    const out = await processIncomingOrder((parseRelayOrder(sample('tgtg', 777)) as any).order);
    expect(out.accept?.status).toBe('blocked');
    expect(calls).toEqual([]);
  });

  it('reads relayed status changes (customer cancelled)', async () => {
    const s = parseRelayStatus({ order_id: 3444567, new_state: 'customer_cancelled', additional_info: { external_channel: { name: 'SkipTheDishes', order_id: 'SKIP-998877' } }, message: 'Wrong address' });
    expect(s).toEqual({ channel: 'skip', externalOrderId: 'relay-3444567', state: 'customer_cancelled', message: 'Wrong address' });
    expect(parseRelayStatus({ order_id: 1, new_state: 'x', additional_info: { external_channel: { name: 'zomato' } } })).toBeNull();
    expect(typeof relayActions.markReady).toBe('function');
    expect(getRepo()).toBeTruthy();
  });
});
