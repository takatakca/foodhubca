// Too Good To Go order e-mails → Food Hub → Clover: the reader (French / English, synthetic fixtures in
// tests/fixtures/tgtg-email), the store mapping, the pipeline (Clover order type + kitchen ticket + tender, cancel =
// flagged, never deleted), idempotency (Message-ID + TGTG code), the attention list, the IMAP poller and the webhook.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetOrderTypeCache, cloverOrderTypeForOrder } from '../lib/foodhub/pos/clover-order';
import { runOrderAction } from '../lib/foodhub/pipeline';
import { getRepo } from '../lib/foodhub/repo';
import { pollTgtgMailbox, type ImapLike } from '../lib/foodhub/tgtg-email/imap';
import { buildTgtgMailOrder, ingestTgtgMail, isTgtgEmailOrder, retryTgtgMail, resolveWaitingForStore, tgtgMailOrderId } from '../lib/foodhub/tgtg-email/ingest';
import { tgtgPickupOrderId } from '../lib/foodhub/tgtg-email/ids';
import { mailFromFields } from '../lib/foodhub/tgtg-email/inbound';
import { mailFromMime } from '../lib/foodhub/tgtg-email/mime';
import { codeFrom, dateFrom, htmlToText, mailKind, moneyFrom, parseTgtgMail, senderAllowed, senderVerified, timesFrom, type TgtgMail } from '../lib/foodhub/tgtg-email/parse';
import {
  getMailboxStatus, getTgtgEmailSettings, listAttention, listMailRecords, mappingProblem, removeTgtgMapping, saveTgtgMapping, setTgtgEmailEnabled, suggestTgtgMapping, tgtgEmailStoreId, tgtgUnmappedStoreId,
} from '../lib/foodhub/tgtg-email/settings';

const FIX = path.join(__dirname, 'fixtures', 'tgtg-email');
const raw = (name: string) => fs.readFileSync(path.join(FIX, name));
const fixture = (name: string) => mailFromMime(raw(name));
const OWNER = { username: 'owner', name: 'Owner', source: 'dashboard' as const };

const MID = 'TESTMERCH0001';
const realFetch = globalThis.fetch;
type Call = { method: string; path: string; body: any };
let calls: Call[] = [];
let seq = 0;
const json = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } });
const sent = (method: string, re: RegExp) => calls.filter((c) => c.method === method && re.test(c.path));

function mockClover() {
  globalThis.fetch = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET').toUpperCase();
    const body = init.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : null;
    calls.push({ method, path: url.pathname, body });
    const p = url.pathname;
    if (url.hostname !== 'api.clover.test') return json({}, 404);
    if (p.endsWith('/order_types')) return json({ elements: [{ id: 'OT-PICKUP', label: 'Online Order Pick Up' }, { id: 'OT-TGTG', label: 'Too Good To Go' }] });
    if (p.endsWith('/tenders')) return method === 'POST' ? json({ id: 'T-NEW', label: body?.label }) : json({ elements: [{ id: 'T-TGTG', label: 'Too Good To Go' }, { id: 'T-CASH', label: 'Cash' }] });
    if (p.endsWith('/atomic_order/orders')) {
      const total = (body.orderCart.lineItems as any[]).reduce((s, l) => s + l.price, 0);
      return json({ id: `CLV${++seq}`, total });
    }
    if (p.endsWith('/print_event')) return json({ id: `PE-${body?.orderRef?.id}`, state: 'CREATED' });
    if (/\/orders\/[^/]+\/payments$/.test(p)) return json({ id: `PAY-${++seq}` });
    if (/\/orders\/[^/]+$/.test(p)) return json({ id: p.split('/').pop(), total: 1198, ...(method === 'GET' ? { note: 'TGTG 3K7Q9XPT2A | MARIE | 2 SACS / BAGS' } : {}) });
    return json({}, 404);
  }) as any;
}

const ENV: Record<string, string> = {
  FOODHUB_FORCE_MEMORY: 'true', FOODHUB_RETRY_TIMER: 'off', FOODHUB_TIMEZONE: 'America/Toronto',
  CLOVER_BASE_URL: 'https://api.clover.test', CLOVER_MERCHANT_ID: MID, CLOVER_ACCESS_TOKEN: 'clover-token',
  TGTG_IMAP_HOST: 'imap.example.test', TGTG_IMAP_USER: 'orders@example.test', TGTG_IMAP_PASSWORD: 'not-a-real-password',
};
const CLEAR = ['CLOVER_MERCHANT_TOKENS', 'FOODHUB_POS_INJECTION', 'FOODHUB_CLOVER_ORDER_TYPE_MODE', 'CLOVER_ORDER_TYPES', 'CLOVER_CLIENT_ID', 'TGTG_EMAIL_FROM_ALLOW', 'TGTG_EMAIL_WEBHOOK_SECRET', 'TGTG_IMAP_PORT', 'TGTG_IMAP_MAILBOX', 'FOODHUB_CLOVER_DELETE_CANCELLED', 'TGTG_EMAIL_AUTHSERV_ID', 'TGTG_EMAIL_WEBHOOK_QUERY_TOKEN', 'TGTG_IMAP_SECURE', 'CLOVER_PRINT_DEVICE_ID', 'CLOVER_PRINT_DEVICES', 'FOODHUB_CLOVER_AUTOPRINT'];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const [k, v] of Object.entries(ENV)) { saved[k] = process.env[k]; process.env[k] = v; }
  for (const k of CLEAR) { saved[k] = process.env[k]; delete process.env[k]; }
  (globalThis as any).__foodhubMem = undefined;
  calls = []; seq = 0;
  _resetOrderTypeCache();
  mockClover();
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
});

/** Clock at a given UTC instant (Date only: promises and fetch keep running). */
const at = (iso: string) => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(iso)); };

/** What the mailbox's own server writes on a genuine Too Good To Go e-mail (synthetic). */
const AUTH = 'mx.example.test; dkim=pass header.d=toogoodtogo.com header.s=synthetic; spf=pass smtp.mailfrom=toogoodtogo.com; dmarc=pass header.from=toogoodtogo.com';
/** A Too Good To Go e-mail built in a test (verified by the receiving server unless told otherwise). */
const tgtgMail = (m: Partial<TgtgMail>): TgtgMail => ({ from: 'no-reply@toogoodtogo.com', authResults: [AUTH], subject: '', ...m });

async function mapOoeuf() {
  await getRepo().upsertStore({ channel: 'doordash', channelStoreId: 'dd-ooeuf', brandName: 'OOeuf', locationCode: 'NDG_6284', cloverMerchantId: MID, autoAccept: true, online: true, meta: {} });
  return saveTgtgMapping({ storeName: 'OOEUF NDG', brandName: 'OOeuf', locationCode: 'NDG_6284' }, OWNER);
}

// ---------------------------------------------------------------- reader

describe('TGTG e-mail reader (synthetic fixtures, FR + EN)', () => {
  it('reads an English plain-text reservation', async () => {
    const m = await fixture('order-en-plain.eml');
    expect(m.from).toBe('no-reply@toogoodtogo.com');
    expect(m.messageId).toBe('<synthetic-order-en-plain-0001@example.test>');
    const p = parseTgtgMail(m);
    expect(p).toMatchObject({ kind: 'order', lang: 'en', code: '3K7Q9XPT2A', firstName: 'Marie', quantity: 2, bagName: 'Breakfast Surprise Bag', pricePaid: 11.98, storeName: 'OOEUF NDG', problems: [], warnings: [] });
    // 17:00–17:30 in Montréal (EDT, UTC−4) on Friday 16 October 2026.
    expect(p.pickupStart).toBe('2026-10-16T21:00:00.000Z');
    expect(p.pickupEnd).toBe('2026-10-16T21:30:00.000Z');
    expect(p.pickupLabel).toContain('17:00–17:30');
  });

  it('reads a French HTML table e-mail (quoted-printable, accents, &nbsp;, "17 h 00 – 17 h 30")', async () => {
    const m = await fixture('order-fr-html.eml');
    expect(m.subject).toBe('Nouvelle commande – OOEUF NDG');
    const p = parseTgtgMail(m);
    expect(p).toMatchObject({ kind: 'order', lang: 'fr', code: 'R8M2-55QX', firstName: 'Lucas', quantity: 1, bagName: 'Panier Surprise Déjeuner', pricePaid: 5.99, storeName: 'OOEUF NDG', storeAddress: '6284 Av Somerled, Montréal', problems: [] });
    expect([p.pickupStart, p.pickupEnd]).toEqual(['2026-10-16T21:00:00.000Z', '2026-10-16T21:30:00.000Z']);
    expect(p.pickupLabel).toMatch(/^ven\. 16 oct\. 17:00–17:30$/);
  });

  it('reads a multipart e-mail with "Tomorrow, 5:00 - 5:30 PM", "1 x Magic Bag" and the code in the subject', async () => {
    const p = parseTgtgMail(await fixture('order-en-multipart-ampm.eml'));
    expect(p).toMatchObject({ kind: 'order', code: 'W9XK3L7Q', firstName: 'Alex', quantity: 1, bagName: 'Magic Bag', pricePaid: 4.99, storeName: 'OOEUF NDG' });
    // Sent at 20:41 on the 16th (local): "tomorrow" = the 17th.
    expect([p.pickupStart, p.pickupEnd]).toEqual(['2026-10-17T21:00:00.000Z', '2026-10-17T21:30:00.000Z']);
  });

  it('reads a French sentence-style e-mail ("Sophie vient de réserver 3 Paniers Surprises chez …, demain entre 18 h 00 et 18 h 45")', async () => {
    const p = parseTgtgMail(await fixture('order-fr-sentence.eml'));
    expect(p).toMatchObject({ kind: 'order', lang: 'fr', code: '7TQ4ZP9M', firstName: 'Sophie', quantity: 3, pricePaid: 17.97, storeName: 'PO POULET SAINT-LÉONARD', problems: [] });
    expect([p.pickupStart, p.pickupEnd]).toEqual(['2026-10-17T22:00:00.000Z', '2026-10-17T22:45:00.000Z']);
  });

  it('reads cancellations in English and French (accents at the end of a word: "a annulé")', async () => {
    expect(parseTgtgMail(await fixture('cancel-en.eml'))).toMatchObject({ kind: 'cancel', code: '3K7Q9XPT2A', firstName: 'Marie', problems: [] });
    expect(parseTgtgMail(await fixture('cancel-fr.eml'))).toMatchObject({ kind: 'cancel', code: 'R8M2-55QX', firstName: 'Lucas', problems: [] });
  });

  it('never guesses a missing code; a newsletter is not an order e-mail', async () => {
    const a = parseTgtgMail(await fixture('attention-no-code.eml'));
    expect(a.kind).toBe('order');
    expect(a.code).toBeUndefined();
    expect(a.problems).toContain('reservation code not found');
    const n = parseTgtgMail(await fixture('newsletter.eml'));
    expect(n.kind).toBe('unknown');
    expect(n.problems).toContain('not an order e-mail');
  });

  it('separate patterns: kind, money, code, times, dates', () => {
    expect(mailKind('Commande annulée', '')).toBe('cancel');
    expect(mailKind('Réservation confirmée', '')).toBe('order');
    expect(mailKind('Hello', 'Marie just reserved 1 Surprise Bag. You can cancel in the app.')).toBe('order');
    expect(moneyFrom('11,98 $')).toBe(11.98);
    expect(moneyFrom('CA$ 5.99')).toBe(5.99);
    expect(moneyFrom('$7')).toBe(7);
    expect(moneyFrom('free')).toBeUndefined();
    expect(codeFrom('#ab12cd34')).toBe('AB12CD34');
    expect(codeFrom('Order')).toBeUndefined();
    expect(timesFrom('17 h 00 – 17 h 30')).toEqual([1020, 1050]);
    expect(timesFrom('5:00 - 5:30 PM')).toEqual([1020, 1050]);
    expect(timesFrom('11:30 am - 12:15 pm')).toEqual([690, 735]);
    expect(timesFrom('de 17h à 17h30')).toEqual([1020, 1050]);
    expect(timesFrom('16 octobre 2026')).toEqual([]);
    const ref = { y: 2026, m: 12, d: 30 };
    expect(dateFrom('2 janvier', ref)).toEqual({ y: 2027, m: 1, d: 2 });
    expect(dateFrom('Friday, October 16, 2026', ref)).toEqual({ y: 2026, m: 10, d: 16 });
    expect(dateFrom('16/10/2026', ref)).toEqual({ y: 2026, m: 10, d: 16 });
    expect(dateFrom('demain', ref)).toEqual({ y: 2026, m: 12, d: 31 });
    expect(dateFrom('17:00', ref)).toBeNull();
    expect(htmlToText('<tr><td>Client</td><td>L&eacute;a</td></tr>')).toContain('Client\tLéa');
  });

  it('pickup across the fall-back day keeps local wall time (EST after 1 Nov 2026)', () => {
    const p = parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'New order #ZZ12AB34 - OOEUF NDG', text: 'Customer: Ana\nQuantity: 1\nPickup: November 2, 2026, 17:00 - 17:30\nOrder ID: ZZ12AB34\nStore: OOEUF NDG', date: '2026-11-02T15:00:00Z' });
    expect(p.pickupStart).toBe('2026-11-02T22:00:00.000Z');
  });

  it('accepts only Too Good To Go From addresses (or the ones the owner allows) — never Sender / Reply-To', async () => {
    expect(senderAllowed({ from: 'Too Good To Go <no-reply@toogoodtogo.com>' })).toBe(true);
    expect(senderAllowed({ from: 'mail@eu.toogoodtogo.com' })).toBe(true);
    expect(senderAllowed({ from: 'attacker@toogoodtogo.com.evil.test' })).toBe(false);
    expect(senderAllowed({ from: 'someone@example.test' })).toBe(false);
    // Review finding: a Reply-To / Sender on Too Good To Go's domain used to let anyone in.
    expect(senderAllowed({ from: 'attacker@evil.test', senders: ['x@toogoodtogo.com'] } as any)).toBe(false);
    const spoof = await mailFromMime(Buffer.from('From: attacker@evil.test\r\nReply-To: x@toogoodtogo.com\r\nSender: y@toogoodtogo.com\r\nX-Original-From: z@toogoodtogo.com\r\nSubject: New order #AB12CD34\r\n\r\nOrder ID: AB12CD34\r\n'));
    expect(spoof.from).toBe('attacker@evil.test');
    expect(senderAllowed(spoof)).toBe(false);
    process.env.TGTG_EMAIL_FROM_ALLOW = 'example.test,boss@other.test';
    expect(senderAllowed({ from: 'someone@example.test' })).toBe(true);
    expect(senderAllowed({ from: 'boss@other.test' })).toBe(true);
    expect(senderAllowed({ from: 'no-reply@toogoodtogo.com' })).toBe(false);
  });

  it('acts only when the mail server vouches for the From domain (topmost Authentication-Results: dkim / dmarc pass)', async () => {
    const from = 'no-reply@toogoodtogo.com';
    expect(senderVerified({ from, authResults: [AUTH] })).toBe(true);
    expect(senderVerified({ from, authResults: ['mx.example.test; dkim=pass header.d=toogoodtogo.com'] })).toBe(true);
    expect(senderVerified({ from: 'mail@eu.toogoodtogo.com', authResults: ['mx.example.test; dmarc=pass header.from=toogoodtogo.com'] })).toBe(true);
    expect(senderVerified({ from, authResults: [] })).toBe(false);
    expect(senderVerified({ from })).toBe(false);
    expect(senderVerified({ from, authResults: ['mx.example.test; dkim=fail header.d=toogoodtogo.com; spf=pass smtp.mailfrom=toogoodtogo.com'] })).toBe(false);
    // DKIM by another domain proves nothing about From.
    expect(senderVerified({ from, authResults: ['mx.example.test; dkim=pass header.d=evil.test; dmarc=fail header.from=toogoodtogo.com'] })).toBe(false);
    expect(senderVerified({ from, authResults: ['mx.example.test; dkim=pass header.d=toogoodtogo.com.evil.test'] })).toBe(false);
    // A forged "pass" written lower in the message by the sender is never read: only the receiving server's (topmost).
    const forged = await mailFromMime(Buffer.from(`Authentication-Results: mx.example.test; dkim=none; dmarc=fail header.from=toogoodtogo.com\r\nFrom: ${from}\r\nAuthentication-Results: ${AUTH.replace(/^mx\.example\.test/, 'fake')}\r\nSubject: New order #AB12CD34\r\n\r\nOrder ID: AB12CD34\r\n`));
    expect(forged.authResults).toHaveLength(2);
    expect(senderVerified(forged)).toBe(false);
    // Pinned to the mailbox server's id: its header is used wherever it is.
    process.env.TGTG_EMAIL_AUTHSERV_ID = 'mx.example.test';
    expect(senderVerified({ from, authResults: ['relay.other.test; dkim=none', AUTH] })).toBe(true);
    expect(senderVerified({ from, authResults: ['fake.test; dkim=pass header.d=toogoodtogo.com'] })).toBe(false);
  });

  it('never turns a word into a reservation code (review probes) — they go to the attention list', async () => {
    const probes: Array<Pick<TgtgMail, 'subject' | 'text'>> = [
      { subject: 'Order confirmation - OOEUF NDG', text: 'Marie just reserved 1 Surprise Bag.\nPickup: today 17:00 - 17:30' },
      { subject: 'New reservation - OOEUF NDG', text: 'Your order details\nMarie just reserved 1 Surprise Bag.' },
      { subject: 'Commande confirmée - OOEUF NDG', text: 'Marie vient de réserver 1 Panier Surprise.' },
      { subject: 'New reservation - OOEUF NDG', text: 'Here is your reservation summary.\nMarie just reserved 1 Surprise Bag.' },
      { subject: 'Order cancelled - OOEUF NDG', text: 'Marie has cancelled their order.' },
      { subject: 'Réservation annulée', text: 'Commande annulée par le client.' },
    ];
    for (const m of probes) {
      const p = parseTgtgMail({ from: 'no-reply@toogoodtogo.com', ...m });
      expect(p.code, m.subject).toBeUndefined();
      expect(p.problems, m.subject).toContain('reservation code not found');
    }
    expect(codeFrom('CONFIRMATION')).toBeUndefined();
    expect(codeFrom('CANCELLED')).toBeUndefined();
    // Real codes still read: labelled, "order #…", "commande n° …".
    expect(parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'Order confirmation #AB12CD34 - OOEUF NDG', text: 'Marie just reserved 1 Surprise Bag.' }).code).toBe('AB12CD34');
    expect(parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'Commande confirmée', text: 'Commande n° 7TQ4ZP9M — Marie vient de réserver 1 Panier Surprise chez OOEUF NDG.' }).code).toBe('7TQ4ZP9M');
    // In the pipeline: attention, never a 'duplicate' of a fake order, nothing in Clover.
    await mapOoeuf();
    at('2026-10-16T13:00:00Z');
    const r1 = await ingestTgtgMail(tgtgMail({ subject: 'Order confirmation - OOEUF NDG', text: 'Marie just reserved 1 Surprise Bag.\nPickup: today 17:00 - 17:30\nStore: OOEUF NDG', messageId: '<probe-1@example.test>' }), 'webhook');
    const r2 = await ingestTgtgMail(tgtgMail({ subject: 'Order confirmation - OOEUF NDG', text: 'Lea just reserved 2 Surprise Bags.\nPickup: today 18:00 - 18:30\nStore: OOEUF NDG', messageId: '<probe-2@example.test>' }), 'webhook');
    const c = await ingestTgtgMail(tgtgMail({ subject: 'Order cancelled', text: 'Marie has cancelled their order.', messageId: '<probe-3@example.test>' }), 'webhook');
    expect([r1.status, r2.status, c.status]).toEqual(['attention', 'attention', 'attention']);
    expect(r1.reason).toMatch(/reservation code not found/);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
  });

  it('takes the price paid before a generic "Price" / "Total" line (the bag value)', () => {
    const p = parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'New order #AB12CD34 - OOEUF NDG', text: 'Price: $14.99 value\nTotal paid: $4.99\nOrder ID: AB12CD34\nStore: OOEUF NDG\nPickup: today 17:00 - 17:30' });
    expect(p.pricePaid).toBe(4.99);
    const fr = parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'Nouvelle commande', text: 'Prix : 15,00 $\nMontant payé : 5,00 $\nNuméro de commande : AB12CD34\nMagasin : OOEUF NDG' });
    expect(fr.pricePaid).toBe(5);
    expect(parseTgtgMail({ from: 'no-reply@toogoodtogo.com', subject: 'New order', text: 'Price: CA$4.99\nOrder ID: AB12CD34' }).pricePaid).toBe(4.99);
  });
});

// ---------------------------------------------------------------- mapping

describe('TGTG store name → brand + kitchen', () => {
  it('suggests from the name and the address; the owner confirms', () => {
    expect(suggestTgtgMapping('OOEUF NDG')).toEqual({ brandName: 'OOeuf', locationCode: 'NDG_MAIN' });
    expect(suggestTgtgMapping('OOEUF NDG', '6284 Av Somerled, Montréal')).toEqual({ brandName: 'OOeuf', locationCode: 'NDG_6284' });
    expect(suggestTgtgMapping('Po Poulet Jean-Talon')).toEqual({ brandName: 'Po Poulet', locationCode: 'SAINT_LEONARD' });
    expect(suggestTgtgMapping('Pi Pita (Saint-Léonard)').locationCode).toBe('SAINT_LEONARD');
  });

  it('refuses Po Poulet anywhere but Saint-Léonard, unknown brands and kitchens', async () => {
    expect(mappingProblem('Po Poulet', 'NDG_MAIN')).toMatch(/Saint-Léonard/);
    expect(mappingProblem('Po Poulet', 'SAINT_LEONARD')).toBeNull();
    expect(mappingProblem('Nope', 'NDG_MAIN')).toMatch(/Unknown brand/);
    expect(mappingProblem('OOeuf', 'MOON')).toMatch(/Unknown kitchen/);
    await expect(saveTgtgMapping({ storeName: 'PO POULET NDG', brandName: 'Po Poulet', locationCode: 'NDG_MAIN' }, OWNER)).rejects.toThrow(/Saint-Léonard/);
  });

  it('saving a mapping creates the Too Good To Go store the pipeline routes with (Clover register of that kitchen)', async () => {
    const { mapping, store } = await mapOoeuf();
    expect(mapping).toMatchObject({ storeName: 'OOEUF NDG', brandName: 'OOeuf', locationCode: 'NDG_6284', cloverMerchantId: MID });
    expect(store).toMatchObject({ channel: 'tgtg', channelStoreId: tgtgEmailStoreId('OOEUF NDG'), autoAccept: true, cloverMerchantId: MID });
    // "Ooeuf  ndg" from another e-mail is the same store.
    expect(tgtgEmailStoreId('Ooeuf - ndg')).toBe(store.channelStoreId);
    expect((await getTgtgEmailSettings()).mappings).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- pipeline

describe('reservation e-mail → order → Clover → kitchen ticket → tender', () => {
  it('builds the order: TGTG code as id, pickup window as ready time, big ticket texts', async () => {
    const p = parseTgtgMail(await fixture('order-en-plain.eml'));
    const n = buildTgtgMailOrder(p, { messageId: 'x' }, null);
    expect(n).toMatchObject({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: 'tgtg-mail-3K7Q9XPT2A', displayId: '3K7Q9XPT2A', customerName: 'Marie', fulfillment: 'pickup', readyBy: '2026-10-16T21:00:00.000Z', subtotal: 11.98, total: 11.98, tax: 0 });
    expect(n.lines[0]).toMatchObject({ quantity: 2, unitPrice: 5.99, total: 11.98 });
    expect(n.lines[0].notes).toContain('MARIE');
    expect(n.notes).toMatch(/TGTG 3K7Q9XPT2A \| MARIE \| 2 SACS \/ BAGS \| RAMASSAGE \/ PICKUP .*17:00–17:30/);
    expect(isTgtgEmailOrder({ channel: 'tgtg', raw: n.raw, externalOrderId: n.externalOrderId })).toBe(true);
  });

  it('creates the Clover order with the "Too Good To Go" order type, prints the ticket once, records the TGTG tender at pickup', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z'); // 10 min before the window: the ticket prints on arrival
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    expect(r).toMatchObject({ status: 'order_created', code: '3K7Q9XPT2A' });
    const order = (await getRepo().getOrder(r.orderId!))!;
    expect(order).toMatchObject({ channel: 'tgtg', status: 'accepted', brandName: 'OOeuf', locationCode: 'NDG_6284', posOrderId: 'CLV1', customerName: 'Marie' });
    const cart = sent('POST', /\/atomic_order\/orders$/)[0].body.orderCart;
    expect(cart.title).toBe('Too Good To Go #3K7Q9XPT2A');
    expect(cart.orderType).toEqual({ id: 'OT-TGTG' });
    expect(cart.note).toContain('Client: Marie');
    expect(cart.note).toContain('TGTG 3K7Q9XPT2A');
    expect(cart.lineItems).toHaveLength(2); // one line per bag, each with its own label text
    expect(cart.lineItems[0].note).toContain('MARIE');
    expect(cart.lineItems[0].price).toBe(599);
    expect(sent('POST', /\/print_event$/)).toHaveLength(1);
    expect(order.timeline?.printedAt).toBeTruthy();

    // Bag ready, then picked up → recorded as paid in Clover with the "Too Good To Go" tender (the one that exists in Clover).
    expect((await runOrderAction(order.id, 'ready')).result.ok).toBe(true);
    expect(sent('POST', /\/payments$/)).toHaveLength(0);
    const done = await runOrderAction(order.id, 'complete');
    expect(done.result.ok).toBe(true);
    const pay = sent('POST', /\/orders\/CLV1\/payments$/);
    expect(pay).toHaveLength(1);
    expect(pay[0].body).toMatchObject({ amount: 1198, tender: { id: 'T-TGTG' }, externalPaymentId: 'tg:tgtg-mail-3K7Q9XPT2A' });
    expect(sent('POST', /\/tenders$/)).toHaveLength(0);
  });

  it('a bag already handed over at the counter with its code (« Sac remis ») is that reservation: a late e-mail is a duplicate, never a second sale', async () => {
    await mapOoeuf();
    at('2026-10-16T21:10:00Z');
    // « Sac remis » with code 3k7q9xpt2a (the order id is the code, as lib/foodhub/tgtg.ts recordBagPickup writes it).
    const { order: handed } = await getRepo().insertOrderIfNew({ channel: 'tgtg', marketplace: 'tgtg', externalOrderId: tgtgPickupOrderId('3k7q9xpt2a'), displayId: '3K7Q9XPT2A', channelStoreId: 'pickup-NDG_6284', brandName: 'OOeuf', fulfillment: 'pickup', placedAt: new Date().toISOString(), currency: 'CAD', subtotal: 11.98, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 11.98, lines: [{ name: 'Surprise Bag', quantity: 2, unitPrice: 5.99, total: 11.98, modifiers: [] }], raw: { source: 'tgtg_pickup', tgtg: { code: '3K7Q9XPT2A' } }, locationCode: 'NDG_6284' });
    expect(handed.externalOrderId).toBe('tgtg-pickup-3K7Q9XPT2A');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    expect(r).toMatchObject({ status: 'duplicate', orderId: handed.id, code: '3K7Q9XPT2A' });
    expect(r.reason).toMatch(/Sac remis/);
    expect(await getRepo().findOrder('tgtg', tgtgMailOrderId('3K7Q9XPT2A'))).toBeNull();
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
    expect(sent('POST', /\/print_event$/)).toHaveLength(0);
  });

  it('a reservation far ahead waits for its fire time (pickup − prep) before printing', async () => {
    await mapOoeuf();
    at('2026-10-16T18:05:00Z');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    const order = (await getRepo().getOrder(r.orderId!))!;
    expect(order.timeline?.scheduledFor).toBe('2026-10-16T21:00:00.000Z');
    expect(order.posOrderId).toBe('CLV1');
    expect(sent('POST', /\/print_event$/)).toHaveLength(0);
  });

  it('is idempotent: the same e-mail twice, or the same TGTG code in another e-mail, never prints twice', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const mail = await fixture('order-en-plain.eml');
    const a = await ingestTgtgMail(mail, 'imap');
    const b = await ingestTgtgMail(mail, 'webhook');
    const c = await ingestTgtgMail({ ...mail, messageId: '<forwarded-copy@example.test>' }, 'webhook');
    expect(a.status).toBe('order_created');
    expect(b).toMatchObject({ status: 'duplicate', orderId: a.orderId });
    expect(c).toMatchObject({ status: 'duplicate', orderId: a.orderId });
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect(sent('POST', /\/print_event$/)).toHaveLength(1);
    expect((await getRepo().listOrders({})).filter((o) => o.channel === 'tgtg')).toHaveLength(1);
    // The same e-mail delivered by IMAP and the webhook at the same moment: one order.
    (globalThis as any).__foodhubMem = undefined;
    calls = [];
    await mapOoeuf();
    const both = await Promise.all([ingestTgtgMail(mail, 'imap'), ingestTgtgMail({ ...mail, messageId: '<other@example.test>' }, 'webhook')]);
    expect(both.map((x) => x.status).sort()).toEqual(['duplicate', 'order_created']);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
  });

  it('cancellation e-mail → order cancelled, Clover order FLAGGED "CANCELLED" (never deleted), no payment', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    const c = await ingestTgtgMail(await fixture('cancel-en.eml'), 'imap');
    expect(c).toMatchObject({ status: 'cancel_applied', orderId: r.orderId });
    const order = (await getRepo().getOrder(r.orderId!))!;
    expect(order.status).toBe('cancelled');
    expect(order.timeline).toMatchObject({ cancelledBy: 'customer' });
    expect(order.timeline?.posClosedAt).toBeTruthy();
    expect(sent('DELETE', /\/orders\/CLV1$/)).toHaveLength(0);
    const flag = sent('POST', /\/orders\/CLV1$/);
    expect(flag).toHaveLength(1);
    expect(flag[0].body.title).toBe('CANCELLED — Too Good To Go #3K7Q9XPT2A');
    // The CANCELLED words are added in front of the note Clover had (code, customer, bags), never replacing it.
    expect(flag[0].body.note).toMatch(/^ANNULÉE \/ CANCELLED/);
    expect(flag[0].body.note).toContain('TGTG 3K7Q9XPT2A | MARIE | 2 SACS / BAGS');
    expect(flag[0].body.note.length).toBeLessThanOrEqual(255);
    expect(sent('POST', /\/payments$/)).toHaveLength(0);
    // The same cancellation again: nothing more.
    expect((await ingestTgtgMail({ ...(await fixture('cancel-en.eml')), messageId: '<again@example.test>' }, 'webhook')).status).toBe('duplicate');
    expect(sent('POST', /\/orders\/CLV1$/)).toHaveLength(1);
  });

  it('the owner\'s FOODHUB_CLOVER_DELETE_CANCELLED=off switch also stops the CANCELLED flag', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    process.env.FOODHUB_CLOVER_DELETE_CANCELLED = 'off';
    expect((await ingestTgtgMail(await fixture('cancel-en.eml'), 'imap')).status).toBe('cancel_applied');
    expect((await getRepo().getOrder(r.orderId!))!.status).toBe('cancelled');
    expect(sent('POST', /\/orders\/CLV1$/)).toHaveLength(0);
    expect(sent('DELETE', /\/orders\/CLV1$/)).toHaveLength(0);
  });

  it('only orders read from e-mails get the forced "Too Good To Go" order type: Deliverect / webhook TGTG orders keep the env type', async () => {
    process.env.CLOVER_ORDER_TYPES = JSON.stringify({ pickup: 'OT-ENV-PICKUP' });
    expect(await cloverOrderTypeForOrder(MID, { channel: 'tgtg', fulfillment: 'pickup', externalOrderId: 'dlv-123', raw: { source: 'deliverect' } })).toBe('OT-ENV-PICKUP');
    expect(await cloverOrderTypeForOrder(MID, { channel: 'tgtg', fulfillment: 'pickup' })).toBe('OT-ENV-PICKUP');
    expect(await cloverOrderTypeForOrder(MID, { channel: 'tgtg', fulfillment: 'pickup', externalOrderId: tgtgMailOrderId('AB12CD34'), raw: { source: 'tgtg_email' } })).toBe('OT-TGTG');
    // Nothing created in Clover for the non-e-mail orders.
    expect(sent('POST', /\/order_types$/)).toHaveLength(0);
  });

  it('a cancellation that arrives before its reservation cancels it on arrival (nothing sent to Clover)', async () => {
    await mapOoeuf();
    at('2026-10-16T13:00:00Z');
    expect((await ingestTgtgMail(await fixture('cancel-fr.eml'), 'imap')).status).toBe('cancel_pending');
    const r = await ingestTgtgMail(await fixture('order-fr-html.eml'), 'imap');
    expect(r.status).toBe('order_created');
    expect((await getRepo().getOrder(r.orderId!))!.status).toBe('cancelled');
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
  });

  it('a store nobody mapped: the order waits on the Command Center (not in Clover, even with one register) + attention list; mapping it sends it', async () => {
    at('2026-10-16T20:50:00Z');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    expect(r.status).toBe('attention');
    expect(r.reason).toMatch(/not mapped/);
    expect((await listAttention()).map((x) => x.id)).toContain(r.id);
    const before = (await getRepo().getOrder(r.orderId!))!;
    expect(before.locationCode).toBeUndefined();
    expect(before.status).toBe('new'); // never accepted for an unmapped store
    // Only one Clover register (CLOVER_MERCHANT_ID) — still nothing sent, nothing printed.
    expect(before.posOrderId).toBeUndefined();
    expect(before.posError).toMatch(/not mapped/);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
    expect(sent('POST', /\/print_event$/)).toHaveLength(0);
    await mapOoeuf();
    expect(await resolveWaitingForStore('OOEUF NDG')).toBe(1);
    const after = (await getRepo().getOrder(r.orderId!))!;
    expect(after).toMatchObject({ locationCode: 'NDG_6284', brandName: 'OOeuf', channelStoreId: tgtgEmailStoreId('OOEUF NDG'), posOrderId: 'CLV1' });
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect((await listAttention()).map((x) => x.id)).not.toContain(r.id);
  });

  it('unmapping a store stops routing to it: map → unmap → a reservation reaches no Clover register and is not accepted', async () => {
    await mapOoeuf();
    await removeTgtgMapping('OOEUF NDG', OWNER);
    const store = await getRepo().findStore('tgtg', tgtgEmailStoreId('OOEUF NDG'));
    expect(store?.autoAccept).toBe(false);
    at('2026-10-16T20:50:00Z');
    const r = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    expect(r.status).toBe('attention');
    const order = (await getRepo().getOrder(r.orderId!))!;
    expect(order).toMatchObject({ status: 'new', channelStoreId: tgtgUnmappedStoreId('OOEUF NDG') });
    expect(order.locationCode).toBeUndefined();
    expect(order.brandName).toBeUndefined();
    expect(order.posOrderId).toBeUndefined();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('unreadable → attention (kept, retry possible); newsletter and strangers → ignored without their body; too late → not sent to the kitchen', async () => {
    await mapOoeuf();
    at('2026-10-16T17:30:00Z');
    const a = await ingestTgtgMail(await fixture('attention-no-code.eml'), 'imap');
    expect(a).toMatchObject({ status: 'attention' });
    expect(a.reason).toMatch(/reservation code not found/);
    const n = await ingestTgtgMail(await fixture('newsletter.eml'), 'imap');
    expect(n.status).toBe('ignored');
    const s = await ingestTgtgMail({ from: 'someone@example.test', subject: 'New order #AB12CD34', text: 'private text' }, 'webhook');
    expect(s.status).toBe('ignored');
    const records = await listMailRecords();
    expect(records.find((x) => x.id === s.id)?.mail.text).toBeUndefined();
    expect(records.find((x) => x.id === n.id)?.mail.text).toBeUndefined();
    expect(records.find((x) => x.id === a.id)?.mail.text).toContain('Nadia');
    // A retry of the unreadable one reads it again (still no code: still attention, not duplicated).
    expect((await retryTgtgMail(a.id, OWNER)).status).toBe('attention');
    expect((await listAttention()).filter((x) => x.id === a.id)).toHaveLength(1);

    at('2026-10-17T02:00:00Z'); // read hours after the 17:00–17:30 window
    const late = await ingestTgtgMail(await fixture('order-en-plain.eml'), 'imap');
    expect(late.status).toBe('too_late');
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
    expect(await getRepo().findOrder('tgtg', tgtgMailOrderId('3K7Q9XPT2A'))).toBeNull();
  });
});

describe('spoofing, one bad e-mail, two copies at once', () => {
  it('a Too Good To Go From the mail server does not vouch for (no DKIM / DMARC pass) creates, prints and cancels nothing', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const real = await fixture('order-en-plain.eml');
    // Same From, but the receiving server found no valid signature (someone typed the From line).
    const forged = { ...real, messageId: '<forged-1@example.test>', authResults: ['mx.example.test; dkim=none; spf=fail smtp.mailfrom=evil.test; dmarc=fail header.from=toogoodtogo.com'] };
    const r = await ingestTgtgMail(forged, 'webhook');
    expect(r.status).toBe('attention');
    expect(r.reason).toMatch(/sender not verified/);
    expect(await getRepo().findOrder('tgtg', tgtgMailOrderId('3K7Q9XPT2A'))).toBeNull();
    // A forged cancellation of a real reservation does nothing either.
    const ok = await ingestTgtgMail(real, 'imap');
    expect(ok.status).toBe('order_created');
    const cancel = await fixture('cancel-en.eml');
    const c = await ingestTgtgMail({ ...cancel, messageId: '<forged-cancel@example.test>', authResults: [] }, 'webhook');
    expect(c.status).toBe('attention');
    expect((await getRepo().getOrder(ok.orderId!))!.status).toBe('accepted');
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
    expect(sent('POST', /\/orders\/CLV1$/)).toHaveLength(0);
  });

  it('two copies of one reservation at once: if the first fails, the second still creates the order (none lost)', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const mail = await fixture('order-en-plain.eml');
    const repo = getRepo();
    const spy = vi.spyOn(repo, 'insertOrderIfNew').mockImplementationOnce(async () => { await new Promise((r) => setTimeout(r, 20)); throw new Error('database unreachable'); });
    const both = await Promise.allSettled([ingestTgtgMail(mail, 'imap'), ingestTgtgMail({ ...mail, messageId: '<copy@example.test>' }, 'webhook')]);
    spy.mockRestore();
    expect(both[0].status).toBe('rejected');
    expect(both[1]).toMatchObject({ status: 'fulfilled', value: { status: 'order_created', code: '3K7Q9XPT2A' } });
    expect(await repo.findOrder('tgtg', tgtgMailOrderId('3K7Q9XPT2A'))).not.toBeNull();
    // The first copy left no record: read again later, it is a duplicate of the order the second copy made.
    expect((await ingestTgtgMail(mail, 'imap')).status).toBe('duplicate');
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------- IMAP + webhook

function fakeImap(messages: Array<{ uid: number; source: Buffer }>, uidValidity = 777n) {
  const log: string[] = [];
  const envelopeOf = async (source: Buffer) => { const m = await mailFromMime(source); return { from: [{ address: m.from }], subject: m.subject }; };
  const headerBlock = (source: Buffer) => Buffer.from(source.toString('utf8').split(/\r?\n\r?\n/)[0]);
  const client: ImapLike & { log: string[] } = {
    log,
    mailbox: { uidValidity, uidNext: Math.max(0, ...messages.map((m) => m.uid)) + 1 },
    async connect() { log.push('connect'); },
    async getMailboxLock(p, o) { log.push(`lock ${p} ro=${o?.readOnly}`); return { release: () => log.push('release') }; },
    async search(q) {
      log.push(`search ${JSON.stringify(q)}`);
      if (typeof q.uid === 'string') { const from = Number(q.uid.split(':')[0]); const hit = messages.filter((m) => m.uid >= from).map((m) => m.uid); return hit.length ? hit : [Math.max(...messages.map((m) => m.uid))]; }
      return messages.map((m) => m.uid);
    },
    async fetchOne(seqs, q) {
      const m = messages.find((x) => String(x.uid) === seqs);
      if (!m) return false;
      if (q.source) { log.push(`source ${seqs}`); return { uid: m.uid, source: m.source }; }
      return { uid: m.uid, envelope: await envelopeOf(m.source), ...(q.headers ? { headers: headerBlock(m.source) } : {}) };
    },
    async logout() { log.push('logout'); },
  };
  return client;
}

describe('IMAP mailbox (read-only, cursor, only verified TGTG senders downloaded)', () => {
  it('reads new TGTG e-mails once, never downloads other mail, keeps a cursor', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const personal = Buffer.from('From: friend@example.test\r\nTo: store@example.test\r\nSubject: Hi\r\nMessage-ID: <p1@example.test>\r\n\r\nPrivate.\r\n');
    const client = fakeImap([{ uid: 5, source: personal }, { uid: 6, source: raw('order-en-plain.eml') }, { uid: 7, source: raw('newsletter.eml') }]);
    const r = await pollTgtgMailbox({ client });
    expect(r).toMatchObject({ ran: true, ok: true, checked: 3, handled: 2, statuses: { order_created: 1, ignored: 1 } });
    expect(client.log).toContain('lock INBOX ro=true');
    expect(client.log.filter((l) => l.startsWith('source'))).toEqual(['source 6', 'source 7']);
    expect(client.log.at(-1)).toBe('logout');
    expect(await getMailboxStatus()).toMatchObject({ uidValidity: '777', lastUid: 7, lastError: null });
    // Next run: only after UID 7 (the server answers "7" to 8:* when nothing is new) → nothing read again.
    const again = await pollTgtgMailbox({ client });
    expect(again).toMatchObject({ ok: true, checked: 0 });
    expect(client.log.some((l) => l.includes('"uid":"8:*"'))).toBe(true);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(1);
  });

  // Both line endings: IMAP servers hand over CRLF, and the fixtures are LF in git but CRLF in a Windows checkout
  // (core.autocrlf). A forgery written for one ending only silently left the genuine DKIM pass in place on the other.
  it.each([['LF', '\n'], ['CRLF', '\r\n']])('a forged Too Good To Go From (Reply-To only, or no DKIM pass) is never downloaded nor acted on (%s)', async (_name, eol) => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const lines = (s: string) => Buffer.from(s.replace(/\r?\n/g, eol));
    const replyTo = lines('From: attacker@evil.test\nReply-To: orders@toogoodtogo.com\nSubject: New order #AB12CD34 - OOEUF NDG\nMessage-ID: <r1@example.test>\n\nOrder ID: AB12CD34\nStore: OOEUF NDG\n');
    const noDkim = lines(raw('order-en-plain.eml').toString('utf8').replace(/^Authentication-Results:[^\r\n]*/, 'Authentication-Results: mx.example.test; dkim=none; dmarc=fail header.from=toogoodtogo.com'));
    // The forgery really took: Too Good To Go's From, but the receiving server vouches for nothing.
    const forged = await mailFromMime(noDkim);
    expect(forged.authResults).toEqual(['mx.example.test; dkim=none; dmarc=fail header.from=toogoodtogo.com']);
    expect(senderAllowed(forged)).toBe(true);
    expect(senderVerified(forged)).toBe(false);
    const client = fakeImap([{ uid: 1, source: replyTo }, { uid: 2, source: noDkim }]);
    const r = await pollTgtgMailbox({ client });
    expect(r).toMatchObject({ ok: true, checked: 2, handled: 1, statuses: { attention: 1 } });
    expect(client.log.filter((l) => l.startsWith('source'))).toEqual([]);
    expect(sent('POST', /\/atomic_order\/orders$/)).toHaveLength(0);
    expect((await listAttention()).some((x) => /sender not verified/.test(x.reason ?? ''))).toBe(true);
  });

  it('one e-mail that throws is kept as "error" (Needs attention) and the next ones still go through; a database outage keeps the cursor', async () => {
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const repo = getRepo();
    const client = fakeImap([{ uid: 10, source: raw('order-fr-html.eml') }, { uid: 11, source: raw('order-en-plain.eml') }]);
    const spy = vi.spyOn(repo, 'insertOrderIfNew').mockImplementationOnce(async () => { throw new Error('unexpected reader state'); });
    const r = await pollTgtgMailbox({ client });
    spy.mockRestore();
    expect(r).toMatchObject({ ok: true, checked: 2, handled: 2, statuses: { error: 1, order_created: 1 } });
    expect(await getMailboxStatus()).toMatchObject({ lastUid: 11, lastError: null });
    const errs = (await listAttention()).filter((x) => x.status === 'error');
    expect(errs).toHaveLength(1);
    expect(errs[0].reason).toMatch(/unexpected reader state/);
    // Retry from Needs attention reads it again: now it goes through.
    expect((await retryTgtgMail(errs[0].id, OWNER)).status).toBe('order_created');

    // Database down: nothing can be recorded → the run stops, the cursor stays before that e-mail.
    const client2 = fakeImap([{ uid: 10, source: raw('order-fr-html.eml') }, { uid: 11, source: raw('order-en-plain.eml') }, { uid: 12, source: raw('order-fr-sentence.eml') }]);
    const down = vi.spyOn(repo, 'getDoc').mockRejectedValue(new Error('database unreachable'));
    const downPut = vi.spyOn(repo, 'putDocs').mockRejectedValue(new Error('database unreachable'));
    const r2 = await pollTgtgMailbox({ client: client2 });
    down.mockRestore();
    downPut.mockRestore();
    expect(r2).toMatchObject({ ok: false, error: 'database unreachable' });
    expect((await getMailboxStatus()).lastUid).toBe(11);
  });

  it('a mailbox error is kept on the status, never thrown; switched off = not read', async () => {
    const client = fakeImap([]);
    client.connect = async () => { throw new Error('Invalid credentials (Failure)'); };
    const r = await pollTgtgMailbox({ client });
    expect(r).toMatchObject({ ran: true, ok: false, error: 'Invalid credentials (Failure)' });
    expect((await getMailboxStatus()).lastError).toBe('Invalid credentials (Failure)');
    await setTgtgEmailEnabled(false, OWNER);
    expect(await pollTgtgMailbox({ client: fakeImap([]) })).toMatchObject({ ran: false });
    delete process.env.TGTG_IMAP_PASSWORD;
    expect((await pollTgtgMailbox()).reason).toMatch(/not configured/);
  });
});

describe('inbound webhook (forwarding services)', () => {
  const call = async (body: BodyInit, headers: Record<string, string>, query = '') => {
    const { POST } = await import('../app/api/foodhub/webhooks/tgtg-email/route');
    const init = { method: 'POST', body, headers, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) } as RequestInit;
    const res = await POST(new Request(`https://hub.test/api/foodhub/webhooks/tgtg-email${query}`, init));
    return { status: res.status, json: await res.json() };
  };

  it('is closed without its secret, checks the token, takes raw MIME, JSON and form fields', async () => {
    expect((await call('x', {})).status).toBe(404);
    process.env.TGTG_EMAIL_WEBHOOK_SECRET = 'tgtg-mail-secret';
    expect((await call('x', { authorization: 'Bearer wrong' })).status).toBe(401);
    await mapOoeuf();
    at('2026-10-16T20:50:00Z');
    const mime = await call(raw('order-en-plain.eml').toString('utf8'), { authorization: 'Bearer tgtg-mail-secret', 'content-type': 'message/rfc822' });
    expect(mime).toMatchObject({ status: 200, json: { ok: true, status: 'order_created', code: '3K7Q9XPT2A' } });
    const fr = await fixture('order-fr-html.eml');
    const frJson = JSON.stringify({ from: fr.from, subject: fr.subject, html: fr.html, messageId: fr.messageId, date: fr.date, authResults: fr.authResults });
    // ?token= in the URL is refused unless the owner opted in (URLs end up in access logs).
    expect((await call(frJson, { 'content-type': 'application/json' }, '?token=tgtg-mail-secret')).status).toBe(401);
    process.env.TGTG_EMAIL_WEBHOOK_QUERY_TOKEN = 'on';
    const asJson = await call(frJson, { 'content-type': 'application/json' }, '?token=tgtg-mail-secret');
    expect(asJson.json).toMatchObject({ ok: true, status: 'order_created', code: 'R8M2-55QX' });
    const form = new FormData();
    const cancel = await fixture('cancel-en.eml');
    form.set('from', `Too Good To Go <${cancel.from}>`); form.set('subject', cancel.subject); form.set('body-plain', cancel.text ?? ''); form.set('Message-Id', cancel.messageId ?? '');
    form.set('message-headers', JSON.stringify([['Authentication-Results', AUTH], ['From', cancel.from]]));
    const asForm = await call(form, { 'x-api-key': 'tgtg-mail-secret' });
    expect(asForm.json).toMatchObject({ ok: true, status: 'cancel_applied', code: '3K7Q9XPT2A' });
    // Resent by the service: duplicate, nothing printed twice.
    expect((await call(raw('order-en-plain.eml').toString('utf8'), { authorization: 'Bearer tgtg-mail-secret' })).json.status).toBe('duplicate');
    expect(sent('POST', /\/print_event$/)).toHaveLength(2);
    // Switched off by the owner: 503 so the service sends it again later.
    await setTgtgEmailEnabled(false, OWNER);
    expect((await call(raw('order-fr-sentence.eml').toString('utf8'), { authorization: 'Bearer tgtg-mail-secret' })).status).toBe(503);
  });

  it('caps the body while reading it: a chunked body with no Content-Length over 5 MB → 413', async () => {
    process.env.TGTG_EMAIL_WEBHOOK_SECRET = 'tgtg-mail-secret';
    const chunk = new Uint8Array(1024 * 1024).fill(65);
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(c) { if (pulled++ < 8) c.enqueue(chunk); else c.close(); } });
    const r = await call(stream, { authorization: 'Bearer tgtg-mail-secret', 'content-type': 'message/rfc822' });
    expect(r.status).toBe(413);
    expect(pulled).toBeLessThan(9);
  });

  it('maps service fields (Mailgun / SendGrid / Postmark names) to an e-mail; Reply-To never counts as the sender', async () => {
    const m = await mailFromFields({ From: 'no-reply@toogoodtogo.com', Subject: 'New order', TextBody: 'hi', 'Message-Id': '<a@b>', Date: 'Fri, 16 Oct 2026 14:05:00 -0400' }) as TgtgMail;
    expect(m).toMatchObject({ from: 'no-reply@toogoodtogo.com', subject: 'New order', text: 'hi', messageId: '<a@b>', date: '2026-10-16T18:05:00.000Z' });
    expect(await mailFromFields({})).toBeNull();
    const spoof = await mailFromFields({ from: 'attacker@evil.test', 'Reply-To': 'x@toogoodtogo.com', 'X-Original-From': 'y@toogoodtogo.com', subject: 'New order #AB12CD34', text: 'Order ID: AB12CD34' }) as TgtgMail;
    expect(senderAllowed(spoof)).toBe(false);
    const sg = await mailFromFields({ from: 'Too Good To Go <no-reply@toogoodtogo.com>', subject: 's', text: 't', dkim: '{@toogoodtogo.com : pass}' }) as TgtgMail;
    expect(senderVerified(sg)).toBe(true);
    const sgHeaders = await mailFromFields({ from: 'no-reply@toogoodtogo.com', subject: 's', text: 't', headers: `Received: by mx\nAuthentication-Results: ${AUTH}\nFrom: no-reply@toogoodtogo.com\n` }) as TgtgMail;
    expect(senderVerified(sgHeaders)).toBe(true);
  });
});
