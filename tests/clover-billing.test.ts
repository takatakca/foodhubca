// TAKATAK Food Hub billing through Clover: subscription status in plain words, extra-brand unit counting, exemptions,
// the monthly metered report (off by default, idempotent per merchant and month, retried, never sent twice), the dry
// run, the price notice and the listing copy. Clover is never called: fetch is mocked. Made-up IDs only (public repo).
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  billingLog, billingView, computeExtraBrands, countExtraBrands, foodhubBillingStatus, previewExtraBrandBilling, primaryBrands, quoteExtraBrand,
  runExtraBrandBilling, setPrimaryBrand, tickExtraBrandBilling,
} from '../lib/foodhub/pos/clover-extra-brands';
import {
  billingStatusText, extraBrandNotice, extraPlatformNotice, formatCad, PRICING_STATEMENT, STANDARD_MONTHLY_CAD, TRIAL_DAYS,
} from '../lib/foodhub/pos/clover-pricing';
import { trialEndOf } from '../lib/foodhub/pos/clover-oauth';
import { LISTING_DESCRIPTION, LISTING_FUNCTIONAL_DESCRIPTION, LISTING_PRICING } from '../lib/foodhub/clover-listing';
import { getRepo } from '../lib/foodhub/repo';
import { GET as billingGet, POST as billingPost } from '../app/api/foodhub/clover-billing/route';
import { GET as quoteGet } from '../app/api/foodhub/clover-billing/quote/route';
import { GET as cronGet } from '../app/api/foodhub/cron/clover-billing/route';
import type { ChannelKey } from '../lib/foodhub/types';

const MID = 'TESTMERCHB001';
const MID2 = 'TESTMERCHB002';
const OWN = 'TESTMERCHOWN1';
const APP = 'TESTAPPBILL01';
const METERED = 'TESTMETERED01';
const OCT = Date.parse('2026-10-15T16:00:00Z');
const NOV = Date.parse('2026-11-02T16:00:00Z');
const DAY = 24 * 3600_000;

const realFetch = globalThis.fetch;
type Call = { url: string; method: string };
let calls: Call[] = [];
let billing: Record<string, unknown> = {};
let meteredStatus = 200;
let meteredTimeout = false;

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    calls.push({ url: String(input), method });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
    const bi = url.pathname.match(/^\/v3\/apps\/([^/]+)\/merchants\/([^/]+)\/billing_info$/);
    if (bi) return json(200, billing[bi[2]] ?? { status: 'ACTIVE', isInTrial: false, appSubscription: { id: 'SUBSTD', name: 'Standard', amount: 5000 } });
    if (/\/metereds\//.test(url.pathname)) {
      if (meteredTimeout) throw Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });
      return json(meteredStatus, { id: 'MTR-1' });
    }
    return json(404, {});
  }) as any;
}

const metered = () => calls.filter((c) => c.method === 'POST' && c.url.includes('/metereds/'));
const billingReads = () => calls.filter((c) => c.url.includes('/billing_info'));

async function connect(...mids: string[]) {
  const exp = Math.floor(Date.parse('2030-01-01T00:00:00Z') / 1000);
  const all: Record<string, unknown> = {};
  for (const m of mids) all[m] = { merchantId: m, name: `Resto ${m.slice(-1)}`, accessToken: `AT-${m}`, accessTokenExpiration: exp, connectedAt: new Date(Date.now() - 5 * DAY).toISOString(), status: 'active', appId: APP };
  await getRepo().setKv('clover_oauth_merchants', all);
}

let storeN = 0;
async function store(channel: ChannelKey, brandName: string, cloverMerchantId: string | null, createdAt: string) {
  const s = await getRepo().upsertStore({ channel, channelStoreId: `S${++storeN}`, brandName, locationCode: 'TESTLOC', cloverMerchantId, autoAccept: true, online: true, meta: {} });
  await getRepo().updateStore(s.id, { createdAt });
  return s;
}

/** First brand on Uber Eats (oldest), second brand on all three platforms + Too Good To Go (never billed). */
async function twoBrands(mid = MID) {
  await store('uber_eats', 'Brand One', mid, '2026-01-01T00:00:00.000Z');
  await store('uber_eats', 'Brand Two', mid, '2026-03-01T00:00:00.000Z');
  await store('doordash', 'Brand Two', mid, '2026-03-02T00:00:00.000Z');
  await store('skip', 'Brand Two', mid, '2026-03-03T00:00:00.000Z');
  await store('tgtg', 'Brand Two', mid, '2026-03-04T00:00:00.000Z');
}

function enable() {
  process.env.FOODHUB_CLOVER_METERED_ENABLED = 'true';
  process.env.CLOVER_METERED_EXTRA_BRAND_ID = METERED;
}

beforeEach(() => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  (globalThis as any).__foodhubMem = undefined;
  process.env.CLOVER_CLIENT_ID = APP;
  process.env.CLOVER_CLIENT_SECRET = 'billing-secret-test';
  process.env.CLOVER_BASE_URL = 'https://api.clover.com';
  for (const k of ['FOODHUB_CLOVER_METERED_ENABLED', 'CLOVER_METERED_EXTRA_BRAND_ID', 'FOODHUB_BILLING_EXEMPT_MERCHANTS', 'CLOVER_MERCHANT_ID', 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_TOKENS', 'DASHBOARD_PASSWORD', 'CRON_SECRET', 'ALERT_WEBHOOK_URL', 'FOODHUB_OWNER_EMAIL']) delete process.env[k];
  calls = []; billing = {}; meteredStatus = 200; meteredTimeout = false; storeN = 0;
  mockClover();
});
afterEach(() => { globalThis.fetch = realFetch; });

describe('price copy (FR / EN)', () => {
  it('states the one price everywhere: 14-day trial, $50/month, + $15 per extra brand per platform, billed by Clover', () => {
    expect(PRICING_STATEMENT.fr).toBe('Essai gratuit de 14 jours, puis 50 $/mois par app, + 15 $ par marque supplémentaire par plateforme, facturé par Clover.');
    expect(PRICING_STATEMENT.en).toBe('14-day free trial, then $50/month per app, + $15 per extra brand per platform, billed by Clover.');
    expect(STANDARD_MONTHLY_CAD).toBe(50);
    expect(TRIAL_DAYS).toBe(14);
    expect(formatCad(45, 'fr')).toBe('45 $');
    expect(formatCad(45, 'en')).toBe('$45');
    expect(formatCad(12.5, 'fr')).toBe('12,50 $');
  });

  it('describes the subscription in plain words', () => {
    expect(billingStatusText({ status: 'ACTIVE', inTrial: true, plan: 'Standard', trialDaysLeft: 9 }, 'fr')).toBe('Essai gratuit : 9 jours restants');
    expect(billingStatusText({ status: 'ACTIVE', inTrial: true, plan: 'Standard', trialDaysLeft: 9 }, 'en')).toBe('Free trial: 9 days left');
    expect(billingStatusText({ status: 'ACTIVE', inTrial: true, plan: 'Standard', trialDaysLeft: 1 }, 'fr')).toBe('Essai gratuit : 1 jour restant');
    expect(billingStatusText({ status: 'ACTIVE', inTrial: true, plan: null, trialDaysLeft: 6, trialEstimated: true }, 'fr')).toBe('Essai gratuit : environ 6 jours restants');
    expect(billingStatusText({ status: 'ACTIVE', inTrial: false, plan: 'Standard' }, 'fr')).toBe('Forfait Standard 50 $/mois');
    expect(billingStatusText({ status: 'ACTIVE', inTrial: false, plan: 'Standard' }, 'en')).toBe('Standard plan $50/month');
    expect(billingStatusText({ status: 'LAPSED', inTrial: false, plan: 'Standard', daysLapsed: 3 }, 'fr')).toBe('Paiement Clover en retard (3 jours)');
    expect(billingStatusText(null, 'en')).toMatch(/unknown/);
  });

  it('price notices: "+15 $/mois pour cette plateforme" and the add-a-brand line', () => {
    expect(extraPlatformNotice('fr')).toBe('+15 $/mois pour cette plateforme');
    expect(extraPlatformNotice('en')).toBe('+$15/month for this platform');
    expect(extraPlatformNotice('fr', 3)).toBe('+45 $/mois pour ces 3 plateformes');
    expect(extraBrandNotice('fr')).toMatch(/^Marque supplémentaire : \+15 \$\/mois pour chaque plateforme/);
    expect(extraBrandNotice('en')).toMatch(/first brand is included in the \$50\/month plan/);
  });

  it('the Clover listing states the price and no longer says the app is free', () => {
    expect(LISTING_PRICING).toEqual(PRICING_STATEMENT);
    expect(LISTING_DESCRIPTION.fr).toContain(PRICING_STATEMENT.fr);
    expect(LISTING_DESCRIPTION.en).toContain(PRICING_STATEMENT.en);
    for (const lang of ['fr', 'en'] as const) {
      const all = `${LISTING_DESCRIPTION[lang]}\n${LISTING_FUNCTIONAL_DESCRIPTION[lang]}`.replace(PRICING_STATEMENT[lang], '');
      expect(all).not.toMatch(/gratuit|\bfree\b|0,00|0\.00|ne facture personne|never charges anyone/i);
    }
    const page = fs.readFileSync(path.join(__dirname, '..', 'app', '(console)', 'settings', 'clover-app', 'page.tsx'), 'utf8');
    expect(page).not.toMatch(/forfait gratuit|free plan/i);
  });
});

describe('extra-brand units', () => {
  const s = (channel: ChannelKey, brandName: string, cloverMerchantId: string | null, createdAt: string) => ({ channel, brandName, cloverMerchantId, createdAt });

  it('first brand included; a second brand on all 3 platforms = 3 units = $45; Too Good To Go never counts', () => {
    const c = countExtraBrands([
      s('uber_eats', 'Brand One', MID, '2026-01-01T00:00:00Z'), s('doordash', 'Brand One', MID, '2026-01-02T00:00:00Z'),
      s('uber_eats', 'Brand Two', MID, '2026-03-01T00:00:00Z'), s('doordash', 'Brand Two', MID, '2026-03-01T00:00:00Z'),
      s('skip', 'Brand Two', MID, '2026-03-01T00:00:00Z'), s('tgtg', 'Brand Two', MID, '2026-03-01T00:00:00Z'), s('tgtg', 'Brand Three', MID, '2026-04-01T00:00:00Z'),
    ], { merchantId: MID });
    expect(c.firstBrand).toBe('Brand One');
    expect(c.firstBrandSource).toBe('oldest');
    expect(c.units).toBe(3);
    expect(c.monthlyCad).toBe(45);
    expect(c.brands.map((b) => [b.brand, b.platforms, b.extra, b.units])).toEqual([
      ['Brand One', ['uber_eats', 'doordash'], false, 0],
      ['Brand Two', ['uber_eats', 'doordash', 'skip'], true, 3],
    ]);
  });

  it('a platform counts once per brand (two locations on Uber Eats = 1 unit); other merchants are left out', () => {
    const c = countExtraBrands([
      s('uber_eats', 'Brand One', MID, '2026-01-01T00:00:00Z'),
      s('uber_eats', 'Brand Two', MID, '2026-02-01T00:00:00Z'), s('uber_eats', 'Brand Two', MID, '2026-02-05T00:00:00Z'),
      s('doordash', 'Brand Three', MID2, '2026-02-01T00:00:00Z'),
    ], { merchantId: MID });
    expect(c.units).toBe(1);
    expect(c.brands.map((b) => b.brand)).toEqual(['Brand One', 'Brand Two']);
  });

  it('the owner\'s "marque principale" wins over the oldest; a deactivated brand is not counted; no-merchant stores follow the default', () => {
    const stores = [
      s('uber_eats', 'Brand One', null, '2026-01-01T00:00:00Z'),
      s('uber_eats', 'Brand Two', MID, '2026-02-01T00:00:00Z'), s('doordash', 'Brand Two', MID, '2026-02-01T00:00:00Z'),
      s('skip', 'Brand Old', MID, '2025-01-01T00:00:00Z'),
    ];
    const c = countExtraBrands(stores, { merchantId: MID, defaultMerchant: MID, primaryBrand: 'Brand Two', inactiveBrands: new Set(['Brand Old']) });
    expect(c.firstBrand).toBe('Brand Two');
    expect(c.firstBrandSource).toBe('owner');
    expect(c.units).toBe(1); // Brand One on Uber Eats only
    // A marked brand with no store is ignored: the oldest is used.
    expect(countExtraBrands(stores, { merchantId: MID, defaultMerchant: MID, primaryBrand: 'Nope' }).firstBrand).toBe('Brand Old');
    // Without a default merchant, the store with no merchant is not this merchant's.
    expect(countExtraBrands(stores, { merchantId: MID, inactiveBrands: new Set(['Brand Old']) }).brands.map((b) => b.brand)).toEqual(['Brand Two']);
  });

  it('reads the store mappings and the saved main brand', async () => {
    await twoBrands();
    expect((await computeExtraBrands(MID)).units).toBe(3);
    await setPrimaryBrand(MID, 'Brand Two');
    expect(await primaryBrands()).toEqual({ [MID]: 'Brand Two' });
    expect((await computeExtraBrands(MID)).units).toBe(1); // now Brand One (Uber Eats) is the extra one
    await setPrimaryBrand(MID, null);
    expect((await computeExtraBrands(MID)).units).toBe(3);
  });
});

describe('subscription status', () => {
  it('trial days from Clover\'s trial end, else estimated from the install; saved 15 minutes', async () => {
    await connect(MID);
    billing[MID] = { status: 'ACTIVE', isInTrial: true, appSubscription: { id: 'SUBSTD', name: 'Standard' }, trialEndTime: Date.now() + 9 * DAY - 3600_000 };
    const s = await foodhubBillingStatus(MID);
    expect(s.text).toEqual({ fr: 'Essai gratuit : 9 jours restants', en: 'Free trial: 9 days left' });
    expect(s).toMatchObject({ tone: 'trial', paid: false, cached: false });
    expect(billingReads()).toHaveLength(1);
    expect((await foodhubBillingStatus(MID)).cached).toBe(true);
    expect(billingReads()).toHaveLength(1);
    // Installed 5 days ago and Clover gives no end: about 9 days left.
    expect(billingView({ status: 'ACTIVE', inTrial: true, plan: null, daysLapsed: null, checkedAt: new Date().toISOString() }, new Date(Date.now() - 5 * DAY).toISOString())).toMatchObject({ trialDaysLeft: 9, trialEstimated: true });
  });

  it('paid subscription: "Forfait Standard 50 $/mois"', async () => {
    await connect(MID);
    const s = await foodhubBillingStatus(MID);
    expect(s.text.fr).toBe('Forfait Standard 50 $/mois');
    expect(s.paid).toBe(true);
  });

  it('reads the trial end in the forms Clover may send', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(trialEndOf({ trialEndTime: 1793000000 }, now)).toBe(new Date(1793000000 * 1000).toISOString());
    expect(trialEndOf({ trialEndDate: '2026-10-25T00:00:00Z' }, now)).toBe('2026-10-25T00:00:00.000Z');
    expect(trialEndOf({ trialDaysRemaining: 9 }, now)).toBe(new Date(now + 9 * DAY).toISOString());
    expect(trialEndOf({}, now)).toBeNull();
  });
});

describe('monthly report to Clover', () => {
  it('is OFF by default: nothing recorded, nothing sent', async () => {
    await connect(MID);
    await twoBrands();
    expect(await runExtraBrandBilling({ now: OCT })).toMatchObject({ ran: false });
    expect(await tickExtraBrandBilling(OCT)).toBeNull();
    expect(metered()).toHaveLength(0);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toBeNull();
    process.env.FOODHUB_CLOVER_METERED_ENABLED = 'true'; // switch on, metered ID missing: still nothing
    expect(await runExtraBrandBilling({ now: OCT })).toMatchObject({ ran: false, reason: expect.stringMatching(/CLOVER_METERED_EXTRA_BRAND_ID/) });
    expect(metered()).toHaveLength(0);
  });

  it('records the month while paid, sends it once the next month with the count, never twice', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    await runExtraBrandBilling({ now: OCT });
    expect(metered()).toHaveLength(0); // October is not over
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ units: 3, firstBrand: 'Brand One' });
    await runExtraBrandBilling({ now: NOV });
    expect(metered()).toHaveLength(1);
    expect(metered()[0].url).toBe(`https://api.clover.com/v3/apps/${APP}/merchants/${MID}/metereds/${METERED}?count=3`);
    await runExtraBrandBilling({ now: NOV + 3600_000 });
    await runExtraBrandBilling({ now: NOV + 2 * DAY });
    expect(metered()).toHaveLength(1);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ report: { state: 'reported', count: 3 } });
    const log = await billingLog();
    expect(log.map((e) => e.event)).toContain('reported');
    expect(log.find((e) => e.event === 'reported')).toMatchObject({ merchantId: MID, month: '2026-10', units: 3, amountCad: 45 });
  });

  it('keeps the highest count of the month (a brand removed before month end is still billed for that month)', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    await runExtraBrandBilling({ now: OCT });
    for (const s of (await getRepo().listStores()).filter((x) => x.brandName === 'Brand Two')) await getRepo().deleteStore(s.id);
    await runExtraBrandBilling({ now: OCT + DAY });
    await runExtraBrandBilling({ now: NOV });
    expect(metered().map((c) => c.url.split('count=')[1])).toEqual(['3']);
  });

  it('exempt merchants are never counted nor reported', async () => {
    enable();
    process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS = `${OWN}, SOMEOTHER`;
    await connect(MID, OWN);
    await twoBrands(MID);
    await twoBrands(OWN);
    const r = await runExtraBrandBilling({ now: OCT });
    expect(r.merchants.find((m) => m.merchantId === OWN)).toMatchObject({ exempt: true });
    await runExtraBrandBilling({ now: NOV });
    expect(metered().map((c) => c.url)).toEqual([expect.stringContaining(`/merchants/${MID}/`)]);
    expect(await getRepo().getKv(`clover_extra_brands:${OWN}:2026-10`)).toBeNull();
  });

  it('nothing is counted during the free trial (count 0 = nothing sent)', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    billing[MID] = { status: 'ACTIVE', isInTrial: true, appSubscription: { name: 'Standard' } };
    await runExtraBrandBilling({ now: OCT });
    billing[MID] = { status: 'ACTIVE', isInTrial: false, appSubscription: { name: 'Standard' } };
    await runExtraBrandBilling({ now: NOV });
    expect(metered()).toHaveLength(0);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ units: 0, report: { state: 'zero' } });
  });

  it('a refusal is tried again (3 tries in all), then given up', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    await runExtraBrandBilling({ now: OCT });
    meteredStatus = 500;
    await runExtraBrandBilling({ now: NOV });
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ report: { state: 'retry', attempts: 1 } });
    await runExtraBrandBilling({ now: NOV + 3600_000 });
    await runExtraBrandBilling({ now: NOV + 7200_000 });
    await runExtraBrandBilling({ now: NOV + 10800_000 });
    expect(metered()).toHaveLength(3);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ report: { state: 'failed', attempts: 3 } });
    expect((await billingLog()).map((e) => e.event)).toEqual(expect.arrayContaining(['refused', 'failed']));
  });

  it('a lost answer (timeout) is never sent again; neither is a run stopped mid-send', async () => {
    enable();
    await connect(MID, MID2);
    await twoBrands(MID);
    await twoBrands(MID2);
    await runExtraBrandBilling({ now: OCT });
    // MID2: a previous run stopped after saving "sending".
    const rec2 = await getRepo().getKv<any>(`clover_extra_brands:${MID2}:2026-10`);
    await getRepo().setKv(`clover_extra_brands:${MID2}:2026-10`, { ...rec2, report: { state: 'sending', count: 3, attempts: 0, at: new Date(NOV).toISOString() } });
    meteredTimeout = true;
    await runExtraBrandBilling({ now: NOV });
    meteredTimeout = false;
    await runExtraBrandBilling({ now: NOV + DAY });
    expect(metered().map((c) => c.url)).toEqual([expect.stringContaining(`/merchants/${MID}/`)]);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`)).toMatchObject({ report: { state: 'uncertain' } });
    expect(await getRepo().getKv(`clover_extra_brands:${MID2}:2026-10`)).toMatchObject({ report: { state: 'uncertain', reason: 'interrupted' } });
  });

  it('the sync tick runs at most once an hour', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    expect(await tickExtraBrandBilling(OCT)).toMatchObject({ ran: true });
    expect(await tickExtraBrandBilling(OCT + 60_000)).toBeNull();
    expect(await tickExtraBrandBilling(OCT + 3600_000)).toMatchObject({ ran: true });
  });
});

describe('dry run', () => {
  it('shows exactly what would be billed, without writing or sending anything', async () => {
    enable();
    await connect(MID);
    await twoBrands();
    await runExtraBrandBilling({ now: OCT });
    const before = JSON.stringify(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`));
    calls = [];
    const p = await previewExtraBrandBilling({ now: NOV });
    expect(p).toMatchObject({ enabled: true, meteredIdSet: true, month: '2026-11', previousMonth: '2026-10' });
    expect(p.merchants[0]).toMatchObject({
      merchantId: MID, exempt: false,
      current: { month: '2026-11', units: 3, amountCad: 45 },
      due: { month: '2026-10', units: 3, amountCad: 45, why: 'ready', wouldSend: true, request: `POST /v3/apps/${APP}/merchants/${MID}/metereds/${METERED}?count=3` },
    });
    expect(metered()).toHaveLength(0);
    expect(JSON.stringify(await getRepo().getKv(`clover_extra_brands:${MID}:2026-10`))).toBe(before);
    expect(await getRepo().getKv(`clover_extra_brands:${MID}:2026-11`)).toBeNull();
  });

  it('says why nothing would be sent (off, exempt)', async () => {
    process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS = OWN;
    await connect(MID, OWN);
    await twoBrands(MID);
    const p = await previewExtraBrandBilling({ now: NOV });
    expect(p.enabled).toBe(false);
    expect(p.merchants.find((m) => m.merchantId === MID)).toMatchObject({ due: { why: 'off', wouldSend: false, request: null }, current: { units: 3 } });
    expect(p.merchants.find((m) => m.merchantId === OWN)).toMatchObject({ exempt: true, due: { why: 'exempt' }, current: { units: 0, amountCad: 0 } });
  });
});

describe('price notice before connecting a store or adding a brand', () => {
  it('+15 $/mois for an extra brand\'s new platform; nothing for the first brand, Too Good To Go, exempt or non-app merchants', async () => {
    await connect(MID);
    await store('uber_eats', 'Brand One', MID, '2026-01-01T00:00:00.000Z');
    await store('uber_eats', 'Brand Two', MID, '2026-03-01T00:00:00.000Z');
    const q = await quoteExtraBrand({ brandName: 'Brand Two', channel: 'doordash', merchantId: MID });
    expect(q).toMatchObject({ applies: true, addedUnits: 1, addedCad: 15, unitsAfter: 2, monthlyAfterCad: 30, firstBrand: 'Brand One' });
    expect(q.text).toEqual({ fr: '+15 $/mois pour cette plateforme', en: '+$15/month for this platform' });
    expect(await quoteExtraBrand({ brandName: 'Brand One', channel: 'doordash', merchantId: MID })).toMatchObject({ applies: false, reason: 'first_brand' });
    expect(await quoteExtraBrand({ brandName: 'Brand Two', channel: 'uber_eats', merchantId: MID })).toMatchObject({ applies: false, reason: 'already_counted' });
    expect(await quoteExtraBrand({ brandName: 'Brand Two', channel: 'tgtg', merchantId: MID })).toMatchObject({ applies: false, reason: 'not_billed_platform' });
    expect(await quoteExtraBrand({ brandName: 'Brand Two', channel: 'doordash', merchantId: 'NOTANAPPMERCH' })).toMatchObject({ applies: false, reason: 'not_app_merchant' });
    process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS = MID;
    expect(await quoteExtraBrand({ brandName: 'Brand Two', channel: 'doordash', merchantId: MID })).toMatchObject({ applies: false, reason: 'exempt' });
    expect(await quoteExtraBrand({ brandName: 'Brand New' })).toMatchObject({ applies: false, reason: 'not_app_merchant' });
    delete process.env.FOODHUB_BILLING_EXEMPT_MERCHANTS;
    const nb = await quoteExtraBrand({ brandName: 'Brand New' });
    expect(nb).toMatchObject({ applies: true, firstBrand: 'Brand One' });
    expect(nb.text?.fr).toMatch(/^Marque supplémentaire : \+15 \$\/mois/);
    expect(calls).toHaveLength(0); // a quote never calls Clover
  });

  it('a brand on a merchant with no brand yet is the first brand (no notice)', async () => {
    await connect(MID);
    expect(await quoteExtraBrand({ brandName: 'Brand One', channel: 'uber_eats', merchantId: MID })).toMatchObject({ applies: false, reason: 'first_brand' });
    expect(await quoteExtraBrand({ brandName: 'Brand One' })).toMatchObject({ applies: false, reason: 'no_brand_yet' });
  });
});

describe('API', () => {
  const owner = { authorization: `Basic ${Buffer.from('owner:Owner-pass-123').toString('base64')}`, 'content-type': 'application/json' };
  const ctx = { params: Promise.resolve({}) } as any;
  beforeEach(() => { process.env.DASHBOARD_PASSWORD = 'Owner-pass-123'; });

  it('GET (owner only) returns the dry run and the log; POST sets the main brand; quote needs a brand', async () => {
    await connect(MID);
    await twoBrands();
    const url = 'http://hub.local/api/foodhub/clover-billing';
    expect((await billingGet(new Request(url) as any, ctx)).status).toBe(401);
    const j = await (await billingGet(new Request(url, { headers: owner }) as any, ctx)).json();
    expect(j.pricing).toEqual(PRICING_STATEMENT);
    expect(j.preview.merchants[0].live.units).toBe(3);
    expect(JSON.stringify(j)).not.toMatch(/AT-TESTMERCH|billing-secret/);
    const r = await billingPost(new Request(url, { method: 'POST', headers: owner, body: JSON.stringify({ action: 'primary', merchantId: MID, brandName: 'Brand Two' }) }) as any, ctx);
    expect(r.status).toBe(200);
    expect(await primaryBrands()).toEqual({ [MID]: 'Brand Two' });
    expect(metered()).toHaveLength(0);
    const q = await (await quoteGet(new Request(`${url}/quote?brand=Brand%20Two&channel=doordash&merchant=${MID}`, { headers: owner }) as any, ctx)).json();
    expect(q.quote).toMatchObject({ applies: false, reason: 'first_brand' });
    expect((await quoteGet(new Request(`${url}/quote`, { headers: owner }) as any, ctx)).status).toBe(400);
  });

  it('cron route needs CRON_SECRET and does nothing while billing is off', async () => {
    const url = 'http://hub.local/api/foodhub/cron/clover-billing';
    process.env.CRON_SECRET = 'cron-secret-test';
    expect((await cronGet(new Request(url) as any)).status).toBe(401);
    const res = await cronGet(new Request(url, { headers: { authorization: 'Bearer cron-secret-test' } }) as any);
    expect(res.status).toBe(200);
    expect((await res.json()).result).toMatchObject({ ran: false });
  });
});
