// "Send a test order to my Clover" (welcome page, approved merchants only).
// Shows a merchant — and a Clover App Market reviewer on a test merchant — exactly what Food Hub does with a delivery
// order, end to end, on their own register: the order is created in Clover with the platform's order type (OPEN), the
// kitchen ticket is sent to the Clover printer, then the order is paid with the platform's tender for exactly the
// total Clover computed, tax included (PAID). Each step reports what Clover really answered — nothing is shown as done
// unless Clover confirmed it.
// The order is clearly marked TEST, is never stored in Food Hub (no kitchen screen, no analytics, no payout check) and
// is never read back as a platform order ("<platform> #<order>" titles are Food Hub's own). 3 test orders per hour per
// merchant at most.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { getRepo } from '../repo';
import type { StoredOrder } from '../types';
import { cloverOrderTotalCents, cloverOrderTypeFor, cloverTenderFor, platformLabel, postCloverPayment } from './clover-books';
import { injectOrder, printCloverOrder } from './clover';
import { connectedCloverMerchantIds } from './clover-oauth';

const LIMIT = 3;
const WINDOW_MS = 60 * 60_000;
const KEY = (mid: string) => `clover-test-orders:${mid}`;
const CHANNEL = 'uber_eats' as const;

export interface TestOrderStep { key: 'created' | 'printed' | 'paid'; ok: boolean; detail: string }
export type TestOrderResult =
  | { ok: true; posOrderId: string; steps: TestOrderStep[] }
  | { ok: false; reason: 'not_approved' | 'limited' | 'clover_refused'; error: string; steps: TestOrderStep[] };

/** A small, obviously fake delivery order: two items, a modifier, a note — like a real platform order. */
export function testOrder(now = new Date()): StoredOrder {
  const ref = crypto.randomBytes(2).toString('hex').toUpperCase();
  const iso = now.toISOString();
  return {
    id: `test-${crypto.randomUUID()}`,
    status: 'new',
    channel: CHANNEL,
    marketplace: CHANNEL,
    externalOrderId: `TEST-${ref}`,
    displayId: `TEST-${ref}`,
    channelStoreId: 'test',
    customerName: 'Food Hub — TEST',
    fulfillment: 'delivery',
    placedAt: iso,
    currency: process.env.FOODHUB_CURRENCY || 'CAD',
    subtotal: 19.5,
    tax: 0,
    deliveryFee: 0,
    tip: 0,
    discount: 0,
    total: 19.5,
    notes: 'TEST ORDER — Food Hub check, not a real order / COMMANDE TEST — vérification Food Hub, pas une vraie commande',
    lines: [
      { name: 'TEST · Poutine', quantity: 1, unitPrice: 12.5, total: 14.5, notes: 'No onions / Sans oignons', modifiers: [{ name: 'Extra cheese / Extra fromage', quantity: 1, unitPrice: 2 }] },
      { name: 'TEST · Soft drink / Boisson', quantity: 2, unitPrice: 2.5, total: 5, modifiers: [] },
    ],
    raw: { test: true },
    createdAt: iso,
    updatedAt: iso,
  };
}

/** Takes one slot of the hourly allowance; false when the merchant already sent LIMIT test orders this hour. */
async function takeSlot(mid: string, nowMs: number): Promise<boolean> {
  const repo = getRepo();
  const recent = ((await repo.getKv<number[]>(KEY(mid)).catch(() => null)) ?? []).filter((t) => nowMs - t < WINDOW_MS);
  if (recent.length >= LIMIT) return false;
  await repo.setKv(KEY(mid), [...recent, nowMs]);
  return true;
}

export async function sendCloverTestOrder(merchantId: string, nowMs = Date.now()): Promise<TestOrderResult> {
  const steps: TestOrderStep[] = [];
  if (!(await connectedCloverMerchantIds().catch(() => [] as string[])).includes(merchantId)) {
    return { ok: false, reason: 'not_approved', error: 'This Clover merchant is not approved yet: nothing is sent to its register.', steps };
  }
  if (!(await takeSlot(merchantId, nowMs))) {
    return { ok: false, reason: 'limited', error: `At most ${LIMIT} test orders per hour.`, steps };
  }
  const order = testOrder(new Date(nowMs));
  const orderTypeId = await cloverOrderTypeFor(merchantId, CHANNEL);
  const injected = await injectOrder(order, merchantId, { orderTypeId });
  if (!injected.ok) {
    steps.push({ key: 'created', ok: false, detail: injected.error });
    await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_test_order', status: 'failed', summary: `Test order not created in Clover for merchant ${merchantId}: ${injected.error}` });
    return { ok: false, reason: 'clover_refused', error: injected.error, steps };
  }
  const posOrderId = injected.posOrderId;
  steps.push({ key: 'created', ok: true, detail: `${platformLabel(CHANNEL)} #${order.displayId} → Clover ${posOrderId}${orderTypeId ? ` (order type “${platformLabel(CHANNEL)}”)` : ''}` });

  const printed = await printCloverOrder(posOrderId, merchantId);
  steps.push({ key: 'printed', ok: printed.ok, detail: printed.message });

  // Pay exactly what Clover computed (its own tax rates apply), so the order closes as PAID.
  const tenderId = await cloverTenderFor(merchantId, CHANNEL);
  const total = await cloverOrderTotalCents(merchantId, posOrderId);
  if (!tenderId) steps.push({ key: 'paid', ok: false, detail: `The “${platformLabel(CHANNEL)}” tender could not be found or created (Payments write permission).` });
  else if (!total) steps.push({ key: 'paid', ok: false, detail: 'Clover did not return the order total.' });
  else {
    const subtotalCents = Math.round(order.subtotal * 100);
    const paid = await postCloverPayment(merchantId, posOrderId, { amount: total, taxAmount: Math.max(0, total - subtotalCents), tenderId, externalPaymentId: `foodhub-test-${order.displayId}` });
    steps.push({ key: 'paid', ok: paid.ok, detail: paid.ok ? `${(total / 100).toFixed(2)} ${order.currency} — tender “${platformLabel(CHANNEL)}”` : paid.error });
  }
  await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_test_order', status: steps.every((s) => s.ok) ? 'success' : 'failed',
    summary: `Test order ${order.displayId} sent to Clover merchant ${merchantId}: ${steps.map((s) => `${s.key} ${s.ok ? 'ok' : 'failed'}`).join(', ')}.` });
  return { ok: true, posOrderId, steps };
}
