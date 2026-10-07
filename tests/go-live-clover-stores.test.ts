// Regression (PR #6 review): Settings → Go-live shows Clover (and the platform) green while no order from the mapped store can
// reach Clover: the Clover row counts merchants that have a token, never whether a MAPPED store's merchant has one.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { goLiveFacts } from '../lib/foodhub/go-live';
import { processIncomingOrder } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import type { NormalizedOrder } from '../lib/foodhub/types';
import { translator } from '../lib/i18n';
import { goLiveSteps, type ChannelsData } from '../lib/ui/go-live-core';

const en = translator('en');
const realFetch = globalThis.fetch;

function uberOrder(id: string): NormalizedOrder {
  return { channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: id, displayId: id.slice(-4), channelStoreId: 'uber-store-ndg', fulfillment: 'delivery',
    placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 12, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 12,
    lines: [{ name: 'Poutine', quantity: 1, unitPrice: 12, total: 12, modifiers: [] }], raw: {} };
}

async function checklist() {
  const facts = await goLiveFacts();
  const ch: ChannelsData = {
    mode: 'supabase', publicUrl: 'https://hub.example', liveEnabled: false, dashboardProtected: true,
    clover: { configured: false, missing: ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN'], app: { configured: false, merchants: [] } },
    channels: [
      { channel: 'uber_eats', label: 'Uber Eats', configured: true, canSend: false, missing: [] },
      { channel: 'doordash', label: 'DoorDash', configured: false, canSend: false, missing: ['DOORDASH_DEVELOPER_ID'] },
      { channel: 'skip', label: 'SkipTheDishes', configured: false, canSend: false, missing: ['SKIP_JET_API_KEY'] },
    ],
    relay: { webhookReady: true, callbackReady: false, channels: ['tgtg'] },
    goLive: facts,
  };
  const stores = (await getRepo().listStores()).map((s) => ({ channel: s.channel, channelStoreId: s.channelStoreId, brandName: s.brandName, locationCode: s.locationCode }));
  return goLiveSteps({ channels: ch, notify: { email: true, sms: true, call: true, chat: true, ai: true }, users: [], devices: [], stores, fees: { confirmed: {} },
    cloverCheck: { report: null }, catalog: [], locations: [] }, en);
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  for (const k of ['CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_CLIENT_ID', 'CLOVER_CLIENT_SECRET', 'FOODHUB_POS_INJECTION', 'LIVE_CONNECTORS_GLOBAL_ENABLED']) vi.stubEnv(k, undefined);
  // One Clover merchant with a token in the environment …
  vi.stubEnv('CLOVER_MERCHANT_TOKENS', JSON.stringify({ MERCH_A: 'tok-a' }));
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ id: 'CLV-1' }), { status: 200 })) as any;
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); globalThis.fetch = realFetch; });

describe('Go-live Clover row vs. the stores that are actually mapped', () => {
  it('store mapped to a merchant without a token: checklist green, every order fails Clover', async () => {
    // … but the only mapped store points at another register (typo, second location, merchant connected later…).
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-store-ndg', brandName: 'Po Poulet', locationCode: 'NDG', cloverMerchantId: 'MERCH_B', autoAccept: true, online: true, meta: {} } as any);

    const out = await processIncomingOrder(uberOrder('uber-golive-1'));
    expect(out.pos?.ok).toBe(false);
    expect(out.pos?.error).toMatch(/No Clover API token for merchant MERCH_B/);

    const steps = await checklist();
    // The thing does not work, so the rows must not be green.
    expect(steps.find((s) => s.key === 'clover')?.state).not.toBe('done');
  });

  it('store mapped without a merchant and no CLOVER_MERCHANT_ID: checklist green, every order fails Clover', async () => {
    await getRepo().upsertStore({ channel: 'uber_eats', channelStoreId: 'uber-store-ndg', brandName: 'Po Poulet', locationCode: 'NDG', cloverMerchantId: null, autoAccept: true, online: true, meta: {} } as any);

    const out = await processIncomingOrder(uberOrder('uber-golive-2'));
    expect(out.pos?.ok).toBe(false);
    expect(out.pos?.error).toMatch(/No Clover merchant configured for this store/);

    const steps = await checklist();
    expect(steps.find((s) => s.key === 'clover')?.state).not.toBe('done');
  });
});
