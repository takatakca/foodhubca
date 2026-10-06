// Skip / DoorDash orders received through UrbanPiper (no platform API): parsed, run through the pipeline,
// and accept/ready go back through UrbanPiper only when its POS API key is set — never shown as sent otherwise.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseUrbanPiperOrder, parseUrbanPiperStatus, upChannel, urbanPiperActions, verifyUrbanPiperWebhook } from '../lib/foodhub/adapters/urbanpiper';
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
  delete process.env.FOODHUB_VIA_URBANPIPER;
  delete process.env.URBANPIPER_USERNAME;
  delete process.env.URBANPIPER_API_KEY;
  process.env.URBANPIPER_WEBHOOK_SECRET = 'up-secret-token-1234567890';
  calls = [];
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response('{"status":"success"}', { status: 200 });
  }) as any;
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.FOODHUB_POS_INJECTION; });

describe('orders through UrbanPiper', () => {
  it('recognises the platforms and checks the webhook token', () => {
    expect(upChannel('SkipTheDishes')).toBe('skip');
    expect(upChannel('doordash')).toBe('doordash');
    expect(upChannel('ubereats')).toBe('uber_eats');
    expect(upChannel('zomato')).toBeNull();
    expect(verifyUrbanPiperWebhook(new Headers(), new URL('https://x/api?token=up-secret-token-1234567890'))).toBe(true);
    expect(verifyUrbanPiperWebhook(new Headers({ authorization: 'Bearer up-secret-token-1234567890' }), new URL('https://x/api'))).toBe(true);
    expect(verifyUrbanPiperWebhook(new Headers(), new URL('https://x/api?token=wrong'))).toBe(false);
  });

  it('turns an UrbanPiper order into a Skip order with lines, options and removals', () => {
    const r = parseUrbanPiperOrder(sample());
    if ('ignored' in r) throw new Error(r.ignored);
    const o = r.order;
    expect(o).toMatchObject({ channel: 'skip', externalOrderId: 'up-3444567', displayId: 'SKIP-998877', channelStoreId: '182304', viaHub: 'urbanpiper', hubOrderId: '3444567', total: 27.6, tax: 3.6, customerName: 'Ana B.', fulfillment: 'delivery' });
    expect(o.lines[0]).toMatchObject({ name: 'Poulet Grillé', quantity: 2, unitPrice: 12, total: 24, externalId: 'clv-1' });
    expect(o.lines[0].modifiers.map((m) => m.name)).toEqual(['Grand', 'Piri-piri']);
    expect(o.lines[0].notes).toContain('Sans Oignons');
  });

  it('ignores platforms not taken from UrbanPiper', () => {
    expect('ignored' in parseUrbanPiperOrder(sample('ubereats'))).toBe(true);
    process.env.FOODHUB_VIA_URBANPIPER = 'skip,doordash,uber_eats';
    expect('ignored' in parseUrbanPiperOrder(sample('ubereats'))).toBe(false);
    expect('ignored' in parseUrbanPiperOrder(sample('zomato'))).toBe(true);
  });

  it('without the UrbanPiper API key, accept is not sent and says so', async () => {
    const r = parseUrbanPiperOrder(sample()) as any;
    const out = await processIncomingOrder(r.order);
    expect(out.accept?.status).toBe('skipped');
    expect(out.accept?.message).toMatch(/Not sent to Skip/);
    expect(calls.filter((c) => c.url.includes('urbanpiper'))).toEqual([]);
  });

  it('with the key, accept and ready go to UrbanPiper', async () => {
    process.env.URBANPIPER_USERNAME = 'biz_user';
    process.env.URBANPIPER_API_KEY = 'k123';
    process.env.FOODHUB_AUTO_ACCEPT_DEFAULT = 'false';
    const r = parseUrbanPiperOrder(sample('doordash', 555)) as any;
    const { order } = await processIncomingOrder(r.order);
    // Clover injection is off here, so the locked rule asks for the explicit "Accept without Clover".
    const acc = await runOrderAction(order.id, 'accept_no_pos');
    expect(acc.result.ok).toBe(true);
    const put = calls.find((c) => c.url.endsWith('/external/api/v1/orders/555/status/'))!;
    expect(put.init?.method).toBe('PUT');
    expect((put.init?.headers as any).Authorization).toBe('apikey biz_user:k123');
    expect(JSON.parse(String(put.init?.body)).new_status).toBe('Acknowledged');
    await runOrderAction(order.id, 'ready');
    expect(JSON.parse(String(calls.at(-1)!.init?.body)).new_status).toBe('Food Ready');
    delete process.env.FOODHUB_AUTO_ACCEPT_DEFAULT;
  });

  it('reads UrbanPiper status changes (customer cancelled)', async () => {
    const s = parseUrbanPiperStatus({ order_id: 3444567, new_state: 'customer_cancelled', additional_info: { external_channel: { name: 'SkipTheDishes', order_id: 'SKIP-998877' } }, message: 'Wrong address' });
    expect(s).toEqual({ channel: 'skip', externalOrderId: 'up-3444567', state: 'customer_cancelled', message: 'Wrong address' });
    expect(parseUrbanPiperStatus({ order_id: 1, new_state: 'x', additional_info: { external_channel: { name: 'zomato' } } })).toBeNull();
    expect(typeof urbanPiperActions.markReady).toBe('function');
    expect(getRepo()).toBeTruthy();
  });
});
