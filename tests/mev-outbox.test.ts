// Takatak MEV (QCMEV) outbox + hooks against a stand-in QCMEV (scripts/e2e/mock-qcmev.mjs): off = nothing at all,
// one receipt per order, credit notes, corrected receipts, retries with the same key, offline receipts, tenders.
// Memory repository, placeholder data only.
import crypto from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error -- plain ESM helper shared with the e2e harness (no type declarations)
import { createMockQcmev, mockQcmevFetch } from '../scripts/e2e/mock-qcmev.mjs';
import { settleInClover } from '../lib/foodhub/clover-settle';
import { addDirectEvent, saveDirectOrder } from '../lib/foodhub/delivery/store';
import type { DirectOrder } from '../lib/foodhub/delivery/types';
import { classify, signMev } from '../lib/foodhub/mev/client';
import { healthRefusal, mevGate, mevMode, setSevOfRecord } from '../lib/foodhub/mev/config';
import { mevOnDirectChange, mevOnOrderChange, requestMevPrint, setDirectTender, storedBaseKey } from '../lib/foodhub/mev/hooks';
import { applyOutcome, jobsFor, MEV_OUTBOX, mevAlerts, replayJob, runMevOutbox, settleMevKicks } from '../lib/foodhub/mev/outbox';
import { claimDocument, claimOrderPrint } from '../lib/foodhub/mev/print-claim';
import { publicReceiptHtml } from '../lib/foodhub/mev/receipt';
import type { MevJob } from '../lib/foodhub/mev/types';
import { getRepo } from '../lib/foodhub/repo';
import { contractMac } from '../lib/foodhub/tenant';
import type { NormalizedOrder, StoredOrder } from '../lib/foodhub/types';

const SECRET = crypto.randomBytes(32).toString('hex');
const BASE = 'http://qcmev.test';
const ACTOR = { username: 'owner', name: 'Owner', source: 'dashboard' as const };
const realFetch = globalThis.fetch;
let mock: any;
let otherCalls: string[] = [];

function env(mode: string) {
  process.env.FOODHUB_MEV = mode;
  process.env.FOODHUB_FEATURE_MEV = 'on';
  process.env.FOODHUB_MEV_LOCATIONS = 'E2E_A,E2E_B';
  process.env.FOODHUB_MEV_URL = BASE;
  process.env.FOODHUB_MEV_SECRET = SECRET;
  process.env.FOODHUB_MEV_RETRY_S = '1,2';
}

beforeEach(async () => {
  process.env.FOODHUB_FORCE_MEMORY = 'true';
  process.env.FOODHUB_RETRY_TIMER = 'off';
  (globalThis as any).__foodhubMem = undefined;
  (globalThis as any).__mevHealth = undefined;
  for (const k of ['FOODHUB_MEV', 'FOODHUB_FEATURE_MEV', 'FOODHUB_MEV_LOCATIONS', 'FOODHUB_MEV_URL', 'FOODHUB_MEV_SECRET', 'FOODHUB_MEV_TRIGGER', 'CLOVER_ACCESS_TOKEN', 'CLOVER_MERCHANT_ID', 'FOODHUB_MEV_CLOVER_NOTE']) delete process.env[k];
  mock = createMockQcmev({ secret: SECRET, tenant: 'takatak', locations: ['E2E_A', 'E2E_B'] });
  otherCalls = [];
  globalThis.fetch = vi.fn(mockQcmevFetch(mock, BASE, async (input: any) => { otherCalls.push(String(input)); return new Response('{}', { status: 404 }); })) as any;
});
afterEach(async () => { await settleMevKicks(); globalThis.fetch = realFetch; });

const posts = () => mock.state.calls.filter((c: any) => c.method === 'POST');

async function platformOrder(p: Partial<NormalizedOrder & StoredOrder> = {}): Promise<StoredOrder> {
  const repo = getRepo();
  const n: NormalizedOrder & { locationCode?: string } = {
    channel: 'uber_eats', marketplace: 'uber_eats', externalOrderId: `uber-${crypto.randomUUID().slice(0, 8)}`, displayId: 'AB12C', channelStoreId: 'store-1', brandName: 'Po Poulet', locationCode: 'E2E_A',
    fulfillment: 'delivery', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 33.98, tax: 5.09, deliveryFee: 2.99, tip: 3, discount: 0, total: 39.07, raw: {},
    lines: [{ name: 'Poulet Grillé', quantity: 2, unitPrice: 15.99, total: 33.98, modifiers: [{ name: 'Piri-piri', quantity: 1, unitPrice: 1 }] }], ...p,
  };
  const { order } = await repo.insertOrderIfNew(n);
  return order;
}

async function accept(o: StoredOrder): Promise<StoredOrder> {
  const repo = getRepo();
  const up = (await repo.patchOrder(o.id, { acceptedAt: new Date().toISOString(), acceptedBy: 'auto' }, { status: 'accepted' }))!;
  await settleInClover(up);
  await settleMevKicks();
  return (await repo.getOrder(o.id))!;
}

describe('off by default', () => {
  it('FOODHUB_MEV unset = off: an accepted order makes no call and writes nothing', async () => {
    expect(mevMode()).toBe('off');
    const o = await accept(await platformOrder());
    expect(mock.state.calls.length).toBe(0);
    expect(otherCalls.length).toBe(0);
    expect(await getRepo().listDocs(MEV_OUTBOX)).toEqual([]);
    expect(o.timeline?.mev).toBeUndefined();
  });
  it('each switch says no on its own: owner switch, allowlist, kitchen system', async () => {
    env('simulator');
    expect(await mevGate('E2E_A')).toEqual({ active: false, reason: 'sev_none' });
    expect(await mevGate('ZZ_OTHER')).toEqual({ active: false, reason: 'not_allowlisted' });
    process.env.FOODHUB_FEATURE_MEV = 'off';
    expect(await mevGate('E2E_A')).toEqual({ active: false, reason: 'switch_off' });
    process.env.FOODHUB_FEATURE_MEV = 'on';
    await setSevOfRecord('E2E_A', 'clover_app', ACTOR);
    expect(await mevGate('E2E_A')).toEqual({ active: false, reason: 'sev_clover_app' });
    await setSevOfRecord('E2E_A', 'qcmev', ACTOR);
    expect(await mevGate('E2E_A')).toEqual({ active: true, mode: 'simulator' });
    await accept(await platformOrder({ locationCode: 'E2E_B' })); // E2E_B: system none
    expect(mock.state.calls.length).toBe(0);
  });
  it('"on" needs PROD + certified; "simulator" never sends to PROD', () => {
    expect(healthRefusal('on', null)).toMatch(/not readable/);
    expect(healthRefusal('on', { environment: 'SIMULATOR', certified: false })).toMatch(/PROD/);
    expect(healthRefusal('on', { environment: 'PROD', certified: true })).toBeNull();
    expect(healthRefusal('simulator', { environment: 'PROD', certified: true })).toMatch(/never/);
    expect(healthRefusal('simulator', { environment: 'SIMULATOR' })).toBeNull();
  });
});

describe('platform orders through QCMEV', () => {
  beforeEach(async () => { env('simulator'); await setSevOfRecord('E2E_A', 'qcmev', ACTOR); });

  it('accepted → one signed sale; the receipt comes back on the order; a second change sends nothing new', async () => {
    const o = await accept(await platformOrder());
    expect(posts().length).toBe(1);
    const call = posts()[0];
    expect(call.path).toBe('/api/v1/integrations/foodhub/sales');
    expect(call.headers['idempotency-key']).toBe(storedBaseKey(o));
    expect(call.body).toMatchObject({ schema: 'foodhub.sale.v1', serviceType: 'LVT', testMode: true, amounts: { tipCents: 0, totalCents: 3907 } });
    const mev = o.timeline?.mev;
    expect(mev?.status).toBe('accepted');
    expect(mev?.noTrans).toMatch(/^\d{6}-0001$/);
    expect(mev?.mentions).toContain('COMMANDE PAR UNE PLATEFORME NUMÉRIQUE');
    expect(mev?.qrImage).toMatch(/^data:image\/(png|svg\+xml);base64,/);
    expect(mev?.qrUrl).toMatch(/^http:\/\/127\.0\.0\.1\//);
    // A paper receipt for the bag (PAP): no public electronic copy.
    expect(mev?.format).toBe('PAP');
    expect(mev?.token).toBeUndefined();
    // Completed later: same receipt, no new call.
    await settleInClover((await getRepo().patchOrder(o.id, { completedAt: new Date().toISOString() }, { status: 'completed' }))!);
    await settleMevKicks();
    expect(posts().length).toBe(1);
    expect(mock.verifyChain()).toMatchObject({ ok: true, count: 1 });
  });

  it('cancelled after the receipt → one full credit note that names the sale', async () => {
    const o = await accept(await platformOrder());
    await settleInClover((await getRepo().patchOrder(o.id, { cancelledAt: new Date().toISOString() }, { status: 'cancelled' }))!);
    await settleMevKicks();
    const credit = posts().find((c: any) => c.path.endsWith('/credit-notes'));
    expect(credit?.path).toBe(`/api/v1/integrations/foodhub/sales/${encodeURIComponent(storedBaseKey(o))}/credit-notes`);
    expect(credit?.body).toMatchObject({ schema: 'foodhub.credit.v1', creditKey: `${storedBaseKey(o)}:cn:1`, reason: 'cancelled', full: true });
    const after = (await getRepo().getOrder(o.id))!;
    expect(after.timeline?.mev?.status).toBe('credited');
    expect(after.timeline?.mev?.creditNotes?.[0]).toMatchObject({ status: 'accepted', reason: 'cancelled' });
    expect(mock.verifyChain()).toMatchObject({ ok: true, count: 2 });
  });

  it('switched off after the receipt: the cancel still gets its credit note; a new order sends nothing', async () => {
    const o = await accept(await platformOrder());
    process.env.FOODHUB_FEATURE_MEV = 'off';
    await settleInClover((await getRepo().patchOrder(o.id, { cancelledAt: new Date().toISOString() }, { status: 'cancelled' }))!);
    await settleMevKicks();
    expect(posts().filter((c: any) => c.path.endsWith('/credit-notes')).length).toBe(1);
    await accept(await platformOrder());
    expect(posts().length).toBe(2);
  });

  it('cancelled before anything was sent → nothing reaches QCMEV', async () => {
    mock.state.down = true;
    const o = await accept(await platformOrder());
    const jobs = await jobsFor(storedBaseKey(o));
    expect(jobs[0]).toMatchObject({ status: 'pending', wait: 'qcmev_unreachable', attempts: 1 });
    // One attempt went out (maybe received): a cancel now must credit it after it lands, not drop it.
    await settleInClover((await getRepo().patchOrder(o.id, {}, { status: 'cancelled' }))!);
    await settleMevKicks();
    expect((await jobsFor(storedBaseKey(o))).map((j) => j.kind)).toEqual(['sale', 'credit']);
  });

  it('a change after the receipt (DoorDash adjustment) → credit note + a corrected receipt that names the first', async () => {
    const o = await accept(await platformOrder());
    await getRepo().updateOrder(o.id, { lines: [{ name: 'Poulet Grillé', quantity: 1, unitPrice: 15.99, total: 16.99, modifiers: [{ name: 'Piri-piri', quantity: 1, unitPrice: 1 }] }], subtotal: 16.99, tax: 2.54, total: 19.53 });
    await mevOnOrderChange(o);
    await settleMevKicks();
    const kinds = posts().map((c: any) => (c.path.endsWith('/credit-notes') ? 'credit' : 'sale'));
    expect(kinds).toEqual(['sale', 'credit', 'sale']);
    const re = posts()[2].body;
    expect(re).toMatchObject({ saleKey: `${storedBaseKey(o)}:r1`, referenceSaleKey: storedBaseKey(o), amounts: { subtotalCents: 1699 } });
    const mev = (await getRepo().getOrder(o.id))!.timeline?.mev;
    expect(mev?.saleKey).toBe(`${storedBaseKey(o)}:r1`);
    expect(mev?.status).toBe('accepted');
    expect(mev?.mentions).toContain('Facture corrigée');
  });

  it('QCMEV down: the job waits, then goes with the same key, body and event id (one invoice)', async () => {
    mock.state.down = true;
    const o = await accept(await platformOrder());
    expect((await jobsFor(storedBaseKey(o)))[0].status).toBe('pending');
    expect((await getRepo().getOrder(o.id))!.timeline?.mev?.status).toBe('pending');
    mock.state.down = false;
    await runMevOutbox({ now: Date.now() + 5_000 });
    const sales = mock.state.calls.filter((c: any) => c.method === 'POST' && c.path.endsWith('/sales'));
    expect(sales.length).toBe(2);
    expect(sales[0].headers['x-event-id']).toBe(sales[1].headers['x-event-id']);
    expect(JSON.stringify(sales[0].body)).toBe(JSON.stringify(sales[1].body));
    expect(mock.state.transactions.length).toBe(1);
    expect((await getRepo().getOrder(o.id))!.timeline?.mev?.status).toBe('accepted');
  });

  it('MEV-WEB down: an offline receipt (local QR) now, the MEV number once it is back', async () => {
    mock.state.mevDown = true;
    const o = await accept(await platformOrder());
    let mev = (await getRepo().getOrder(o.id))!.timeline?.mev;
    expect(mev?.status).toBe('offline');
    expect(mev?.noTrans).toBeTruthy();
    expect(mev?.text80mm?.filter((l) => l.trim() === 'PROBLÈME DE COMMUNICATION')).toHaveLength(2);
    mock.state.mevDown = false;
    await runMevOutbox({ now: Date.now() + 6 * 60_000 });
    mev = (await getRepo().getOrder(o.id))!.timeline?.mev;
    expect(mev?.status).toBe('accepted');
    expect(mev?.mevNumber).toMatch(/^MEV-/);
  });

  it('shadow mode maps and checks only: nothing is sent', async () => {
    process.env.FOODHUB_MEV = 'shadow';
    const o = await accept(await platformOrder());
    expect(mock.state.calls.length).toBe(0);
    const jobs = await jobsFor(storedBaseKey(o));
    expect(jobs[0]).toMatchObject({ status: 'skipped', shadow: true });
    expect((await getRepo().getOrder(o.id))!.timeline?.mev?.status).toBe('shadow');
  });

  it('the Too Good To Go daily log is one not-printed LVT sale; a reprint and a merchant copy are transmitted', async () => {
    const log = await accept(await platformOrder({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: 'tgtg-log-2026-10-24-E2E_A', raw: { source: 'daily_log' }, tax: 0, subtotal: 17.97, total: 17.97, tip: 0, deliveryFee: 0, lines: [{ name: 'Surprise Bag', quantity: 3, unitPrice: 5.99, total: 17.97, modifiers: [] }] }));
    expect(log.timeline?.mev).toMatchObject({ status: 'accepted', format: 'NON' });
    expect(posts()[0].body.receipt.format).toBe('NON');
    expect(log.timeline?.mev?.token).toBeUndefined();
    const o = await accept(await platformOrder());
    expect((await requestMevPrint('stored', o.id, 'DUP', ACTOR)).ok).toBe(true);
    expect((await requestMevPrint('stored', o.id, 'RPR', ACTOR)).ok).toBe(true);
    await settleMevKicks();
    const prints = posts().filter((c: any) => c.path.endsWith('/prints'));
    expect(prints.map((c: any) => c.body.mode)).toEqual(['DUP', 'RPR']);
    const mev = (await getRepo().getOrder(o.id))!.timeline?.mev;
    expect(mev?.prints?.find((p) => p.mode === 'DUP')?.text80mm?.join('\n')).toMatch(/COPIE DU COMMERÇANT[\s\S]*NE PAS REMETTRE AU CLIENT/);
  });

  it('platform numbers that do not add up: held for a person (never sent, never balanced); sent once the order is fixed', async () => {
    const o = await accept(await platformOrder({ subtotal: 35, tax: 5.24, total: 40.23 }));
    const mev = o.timeline?.mev;
    expect(mev?.status).toBe('needs_human');
    expect(mev?.reason).toMatch(/^amounts_mismatch: items 33\.98 \$ ≠ subtotal 35\.00 \$/);
    expect(posts().length).toBe(0);
    expect((await mevAlerts(Date.now()))[0]).toMatchObject({ severity: 'critical' });
    // « Renvoyer » maps it again: still wrong → still held, still nothing sent.
    const [job] = await jobsFor(storedBaseKey(o));
    await replayJob(job.id, ACTOR);
    await settleMevKicks();
    expect(posts().length).toBe(0);
    // A person fixes the order: the next change sends the truthful sale (same key), no « ÉCART » line.
    const repo = getRepo();
    await repo.updateOrder(o.id, { subtotal: 33.98, tax: 5.09, total: 39.07 });
    await mevOnOrderChange({ id: o.id });
    await settleMevKicks();
    const sent = posts().filter((c: any) => c.path.endsWith('/sales'));
    expect(sent).toHaveLength(1);
    expect(sent[0].body.saleKey).toBe(storedBaseKey(o));
    expect(JSON.stringify(sent[0].body.lines)).not.toMatch(/ÉCART/);
    expect((await repo.getOrder(o.id))!.timeline?.mev?.status).toBe('accepted');
  });

  it('printed once: the original, then each copy, once; a paper receipt has no public electronic copy', async () => {
    const o = await accept(await platformOrder());
    const mev = (await getRepo().getOrder(o.id))!.timeline!.mev!;
    expect(mev.format).toBe('PAP');
    expect(mev.token).toBeUndefined();
    expect(publicReceiptHtml(mev, {})).toBeNull();
    const first = await claimOrderPrint(mev, 'FAC', 'Cuisine');
    const second = await claimOrderPrint(mev, 'FAC', 'Comptoir');
    expect(first.granted).toBe(true);
    expect(second).toMatchObject({ granted: false, reason: 'printed', by: 'Cuisine' });
    expect(await claimOrderPrint(mev, 'RPR', 'Cuisine')).toMatchObject({ granted: false, reason: 'nothing_to_print' });
    // Two tickets racing for the same document: one wins.
    const race = await Promise.all([claimDocument('doc-race', 'A'), claimDocument('doc-race', 'B')]);
    expect(race.filter((r) => r.granted)).toHaveLength(1);
  });

  it('pending for 15+ minutes raises a Watchtower alert; the legal-limit side is critical at 24 h', async () => {
    mock.state.down = true;
    await accept(await platformOrder());
    expect(await mevAlerts(Date.now())).toEqual([]);
    expect((await mevAlerts(Date.now() + 16 * 60_000))[0]).toMatchObject({ severity: 'warning' });
    expect((await mevAlerts(Date.now() + 25 * 3600_000))[0]).toMatchObject({ severity: 'critical' });
  });
});

describe('own orders through QCMEV', () => {
  beforeEach(async () => { env('simulator'); await setSevOfRecord('E2E_A', 'qcmev', ACTOR); });
  const now = new Date().toISOString();
  const base = (p: Partial<DirectOrder>): DirectOrder => ({
    id: `dir_${crypto.randomBytes(4).toString('hex')}`, number: 'T-1042', source: 'phone', brandName: 'Po Poulet', locationCode: 'E2E_A', customer: { name: 'Client Test' }, fulfillment: 'pickup',
    lines: [{ name: 'Poulet Grillé', quantity: 1, unitPrice: 14.99, total: 14.99, modifiers: [] }], subtotal: 14.99, tax: 2.25, deliveryFee: 0, tip: 2, total: 19.24, currency: 'CAD',
    payment: 'pay_at_pickup', status: 'in_kitchen', containsAlcohol: false, placedAt: now, events: [], createdAt: now, updatedAt: now, ...p,
  });

  it('picked up, tender unknown → waits (never sent as INC); the staff picks cash → sent as ARG with the tip', async () => {
    const d = await saveDirectOrder(base({}));
    await addDirectEvent(d, 'picked_up', 'Picked up by the customer', 'Owner', { status: 'completed' });
    await settleMevKicks();
    expect(posts().length).toBe(0);
    const jobs = await jobsFor(`fh:takatak:direct:phone:${d.id}`);
    expect(jobs[0]).toMatchObject({ status: 'pending', wait: 'tender_unknown' });
    await runMevOutbox({ now: Date.now() + 120_000 });
    expect(posts().length).toBe(0);
    await setDirectTender(d.id, 'ARG', ACTOR);
    await settleMevKicks();
    expect(posts().length).toBe(1);
    expect(posts()[0].body).toMatchObject({ serviceType: 'CMP', payment: { mode: 'ARG', collectedBy: 'cash' }, amounts: { tipCents: 200 } });
  });

  it('paid online with an e-mail → PEL: the public page is the electronic invoice (QR in the block, link under it, « Copie électronique »)', async () => {
    const now = new Date().toISOString();
    const d = await saveDirectOrder({ id: 'dir_pel1', number: 'W-77', source: 'website', brandName: 'Po Poulet', locationCode: 'E2E_A', customer: { name: 'Client Web', email: 'client@example.invalid' }, fulfillment: 'pickup',
      lines: [{ name: 'Poulet Grillé', quantity: 1, unitPrice: 14.99, total: 14.99, modifiers: [] }], subtotal: 14.99, tax: 2.25, deliveryFee: 0, tip: 0, total: 17.24, currency: 'CAD', payment: 'paid', status: 'new', containsAlcohol: false,
      placedAt: now, events: [{ at: now, type: 'received', message: 'Web' }], createdAt: now, updatedAt: now } as DirectOrder);
    await mevOnDirectChange(d);
    await settleMevKicks();
    const { getDirectOrder } = await import('../lib/foodhub/delivery/store');
    const mev = (await getDirectOrder('dir_pel1'))!.mev!;
    expect(mev.format).toBe('PEL');
    expect(mev.token).toBeTruthy();
    const html = publicReceiptHtml(mev, { brand: 'Po Poulet' })!;
    expect(html).toMatch(/<img class="qr"[^>]*><p class="link"><a href="[^"]+"[^>]*>Consulter la transaction en ligne<\/a><\/p>/);
    expect(html).toContain('Copie électronique');
    expect(html).not.toContain('[CODE QR]');
  });

  it('website delivery paid online → LVR, e-commerce card sale right away', async () => {
    const d = await saveDirectOrder(base({ source: 'website', sourceRef: 'web-1', fulfillment: 'delivery', deliveryFee: 4.99, tip: 0, tax: 2.99, total: 22.97, payment: 'paid' }));
    await mevOnDirectChange(d);
    await settleMevKicks();
    expect(posts()[0].body).toMatchObject({ serviceType: 'LVR', ecommerce: true, payment: { mode: 'CRE' }, fees: { deliveryCents: 499 } });
  });
});

describe('client pieces', () => {
  it('signs exactly like tenant.ts (HMAC over "<ts>.<event>.<body>"), Unix ms timestamp', () => {
    const h = signMev('{"a":1}', 'evt-1', 'key-1', 'takatak', SECRET, 1_760_000_000_000);
    expect(h['X-Timestamp']).toBe('1760000000000');
    expect(h['X-Signature']).toBe(`sha256=${contractMac(SECRET, '1760000000000', 'evt-1', '{"a":1}')}`);
    expect(h).toMatchObject({ 'X-Integration-Id': 'foodhub', 'X-Tenant-Id': 'takatak', 'Idempotency-Key': 'key-1' });
  });
  it('answers are classified as the contract says', () => {
    expect(classify(200, { status: 'accepted', receipt: { noTrans: '1' } }).kind).toBe('accepted');
    expect(classify(200, { status: 'rejected', errors: [{ codRetour: '95', mess: 'x' }] }).kind).toBe('rejected');
    expect(classify(202, { status: 'queued', retryAfterS: 30 })).toEqual({ kind: 'queued', retryAfterS: 30 });
    expect(classify(409, {}).kind).toBe('conflict');
    expect(classify(422, { fields: ['x'] }).kind).toBe('invalid');
    expect(classify(423, {}).kind).toBe('not_ready');
    expect(classify(401, {}).kind).toBe('auth');
    expect(classify(503, {}).kind).toBe('retry');
  });
  it('a refused job waits for a person; a time-out retries on the schedule', () => {
    const j = { id: 'x', key: 'k', kind: 'sale', baseKey: 'k', saleKey: 'k', order: { model: 'stored', id: 'o', locationCode: 'E2E_A', label: 'x' }, status: 'sending', payload: {} as never, payloadHash: 'h', attempts: 0, nextAt: null, createdAt: '', updatedAt: '' } as MevJob;
    expect(applyOutcome(j, 409, { kind: 'conflict', message: 'c' }, 0)).toMatchObject({ status: 'needs_human', attempts: 1 });
    process.env.FOODHUB_MEV_RETRY_S = '15,60,300';
    const r = applyOutcome(j, 0, { kind: 'retry', message: 't' }, 0);
    expect(r).toMatchObject({ status: 'pending', wait: 'qcmev_unreachable', nextAt: new Date(15_000).toISOString() });
    expect(applyOutcome({ ...j, attempts: 5 }, 0, { kind: 'retry', message: 't' }, 0).nextAt).toBe(new Date(300_000).toISOString());
  });
});
