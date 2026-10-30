// TAKATAK Suite bus: Food Hub → suite apps (signed events) and app → app (through Food Hub). Contract: docs/TAKATAK_SUITE.md.
//
// Orders are never touched here. The bus only WATCHES them: each tick compares the recent orders with the last status it
// told the apps about, and queues one event per change in an outbox (one copy per connected app). A failed delivery is
// retried with backoff for about a day, then marked failed and logged; it never blocks or slows the order pipeline.
//
// Privacy: events carry no customer name, phone, email or address. With FOODHUB_SUITE_CUSTOMER_SALT set, an order with a
// real (unmasked) phone carries `customerKey` = HMAC(salt, phone): the same customer gets the same key in every app
// (loyalty, rewards, messages work together) and no app can read the phone back.
import crypto from 'node:crypto';
import { logActivity } from '../activity';
import { getRepo } from '../repo';
import type { OrderStatus, StoredOrder } from '../types';
import { customerContact } from '../watch/customer';
import { connectedSuiteApps, suiteApp, type SuiteAppConfig, type SuiteEventType } from './apps';
import { installCounts, recordDirectoryEvent } from './directory';
import { APP_HEADER, SIGNATURE_HEADER, signSuite } from './sign';

export const OUTBOX = 'suite_outbox';
const SEEN_KEY = 'suite:seen';
const LOOKBACK_MS = 48 * 3600_000;
const MAX_ATTEMPTS = 12;
const SEND_TIMEOUT_MS = 8000;
const KEEP_SENT_MS = 24 * 3600_000;

export interface SuiteEvent {
  /** Stable id: the same change always has the same id (apps use it to ignore repeats). */
  id: string;
  type: SuiteEventType;
  createdAt: string;
  source: string;
  data: Record<string, unknown>;
}

export interface OutboxItem {
  app: string;
  event: SuiteEvent;
  status: 'pending' | 'sent' | 'failed';
  attempts: number;
  nextAt: string;
  lastError?: string | null;
  sentAt?: string | null;
}

/** What apps see of an order: what was ordered, where, when, how much. Never who (see `customerKey`). */
export function orderView(o: StoredOrder, merchantOf: (o: StoredOrder) => string | null = () => null): Record<string, unknown> {
  const salt = (process.env.FOODHUB_SUITE_CUSTOMER_SALT ?? '').trim();
  const contact = salt.length >= 16 ? customerContact(o) : null;
  const customerKey = contact?.phone && contact.canSms ? crypto.createHmac('sha256', salt).update(contact.phone).digest('hex').slice(0, 32) : null;
  return {
    orderId: o.id, channel: o.channel, displayId: o.displayId ?? null, brandName: o.brandName ?? null, locationCode: o.locationCode ?? null,
    cloverMerchantId: merchantOf(o), cloverOrderId: o.posOrderId ?? null, status: o.status, fulfillment: o.fulfillment,
    placedAt: o.placedAt, readyBy: o.readyBy ?? null, currency: o.currency,
    subtotal: o.subtotal, tax: o.tax, deliveryFee: o.deliveryFee, tip: o.tip, discount: o.discount, total: o.total,
    lines: o.lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPrice: l.unitPrice, total: l.total, cloverItemId: l.posItemRef ?? null })),
    ...(customerKey ? { customerKey } : {}),
  };
}

async function merchantLookup(): Promise<(o: StoredOrder) => string | null> {
  const stores = await getRepo().listStores().catch(() => []);
  const byStore = new Map(stores.map((s) => [`${s.channel}|${s.channelStoreId}`, s.cloverMerchantId ?? null]));
  return (o) => byStore.get(`${o.channel}|${o.channelStoreId}`) ?? null;
}

/** Queue one event for every connected app that takes this type (each app gets its own copy, retried on its own). */
export async function queueEvent(event: SuiteEvent, apps: SuiteAppConfig[] = connectedSuiteApps(), exceptApp?: string): Promise<number> {
  const repo = getRepo();
  const wanted = apps.filter((a) => a.subscribed.includes(event.type) && a.key !== exceptApp);
  // A copy already queued (or sent) is never queued again: the same change is told once to each app.
  const exists = await Promise.all(wanted.map((a) => repo.getDoc<OutboxItem>(OUTBOX, `${event.id}:${a.key}`)));
  const targets = wanted.filter((_, i) => !exists[i]);
  if (!targets.length) return 0;
  const now = new Date().toISOString();
  await repo.putDocs<OutboxItem>(OUTBOX, targets.map((a) => ({
    id: `${event.id}:${a.key}`, key: 'pending', at: now, data: { app: a.key, event, status: 'pending', attempts: 0, nextAt: now },
  })));
  return targets.length;
}

/** Compare recent orders with what the apps were told; queue order.created / order.status_changed. */
export async function detectOrderChanges(now = Date.now()): Promise<{ queued: number; baseline?: boolean }> {
  const apps = connectedSuiteApps().filter((a) => a.subscribed.some((t) => t.startsWith('order.')));
  if (!apps.length) return { queued: 0 };
  const repo = getRepo();
  const seen = await repo.getKv<Record<string, { s: OrderStatus; at: string }>>(SEEN_KEY);
  const orders = await repo.listOrders({ since: new Date(now - LOOKBACK_MS).toISOString(), limit: 3000 });
  const next: Record<string, { s: OrderStatus; at: string }> = {};
  for (const o of orders) next[o.id] = seen?.[o.id] ?? { s: o.status, at: o.createdAt };
  if (!seen) {
    // First run: today's orders are the starting point. Apps are not flooded with history (they can read it with GET /orders).
    await repo.setKv(SEEN_KEY, next);
    return { queued: 0, baseline: true };
  }
  const merchantOf = await merchantLookup();
  let queued = 0;
  const iso = new Date(now).toISOString();
  for (const o of orders) {
    const prev = seen[o.id];
    if (prev && prev.s === o.status) continue;
    const type: SuiteEventType = prev ? 'order.status_changed' : 'order.created';
    // One id per change (the outbox copy id is "<event id>:<app>"), so a repeated tick queues nothing more.
    const id = prev ? `ord_${o.id}_${o.status}` : `ord_${o.id}_created`;
    queued += await queueEvent({ id, type, createdAt: iso, source: 'foodhub', data: { order: orderView(o, merchantOf), previousStatus: prev?.s ?? null } }, apps);
    next[o.id] = { s: o.status, at: o.createdAt };
  }
  await repo.setKv(SEEN_KEY, next);
  return { queued };
}

const backoffMs = (attempts: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));

/** Send what is due. Each app's copy is independent: one app down never holds the others. */
export async function deliverOutbox(now = Date.now(), fetcher: typeof fetch = fetch): Promise<{ sent: number; failed: number; retrying: number }> {
  const repo = getRepo();
  const docs = await repo.listDocs<OutboxItem>(OUTBOX, { keys: ['pending'], limit: 200 });
  let sent = 0; let failed = 0; let retrying = 0;
  for (const d of docs) {
    const item = d.data;
    if (item.status !== 'pending' || Date.parse(item.nextAt) > now) continue;
    const app = suiteApp(item.app);
    if (!app?.connected || !app.url || !app.secret) continue; // disconnected meanwhile: keep it until it comes back
    const body = JSON.stringify(item.event);
    let error: string | null = null;
    try {
      const res = await fetcher(app.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [SIGNATURE_HEADER]: signSuite(app.secret, body, now), [APP_HEADER]: 'foodhub', 'x-takatak-event': item.event.type },
        body, signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!res.ok) error = `HTTP ${res.status}`;
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    const attempts = item.attempts + 1;
    if (!error) {
      sent++;
      await repo.putDocs<OutboxItem>(OUTBOX, [{ id: d.id, key: 'sent', at: d.at, data: { ...item, status: 'sent', attempts, sentAt: new Date(now).toISOString(), lastError: null } }]);
    } else if (attempts >= MAX_ATTEMPTS) {
      failed++;
      await repo.putDocs<OutboxItem>(OUTBOX, [{ id: d.id, key: 'failed', at: d.at, data: { ...item, status: 'failed', attempts, lastError: error } }]);
      await logActivity({ actor: 'TAKATAK Suite', source: 'automation', kind: 'settings', action: 'suite_delivery_failed', status: 'failed', summary: `${app.name} did not take event ${item.event.type} (${item.event.id}) after ${attempts} tries: ${error}` });
    } else {
      retrying++;
      await repo.putDocs<OutboxItem>(OUTBOX, [{ id: d.id, key: 'pending', at: d.at, data: { ...item, attempts, lastError: error, nextAt: new Date(now + backoffMs(attempts)).toISOString() } }]);
    }
  }
  // Sent copies are kept a day for the Settings page, then dropped.
  const old = (await repo.listDocs<OutboxItem>(OUTBOX, { keys: ['sent'], limit: 500 })).filter((d) => now - Date.parse(d.data.sentAt ?? d.at ?? '') > KEEP_SENT_MS);
  if (old.length) await repo.deleteDocs(OUTBOX, old.map((d) => d.id));
  return { sent, failed, retrying };
}

let running = false;
/** Background tick (instrumentation timer + cron/watch). Off and free until an app is connected; never throws. */
export async function tickSuite(now = Date.now()): Promise<{ queued: number; sent: number; failed: number; retrying: number } | { skipped: string }> {
  if (!connectedSuiteApps().length) return { skipped: 'no app connected' };
  if (running) return { skipped: 'already running' };
  running = true;
  try {
    const { queued } = await detectOrderChanges(now);
    return { queued, ...(await deliverOutbox(now)) };
  } catch (e) {
    console.error('[foodhub] suite tick failed', e instanceof Error ? e.message : e);
    return { skipped: 'error' };
  } finally {
    running = false;
  }
}

/**
 * An app's own event (e.g. "loy4lty.points_awarded"): logged, then passed on as app.event to the other connected apps.
 * "<app>.installed" / "<app>.uninstalled" also update the suite directory (which restaurant has which app).
 */
export async function receiveAppEvent(appKey: string, input: { id: string; type: string; data?: unknown }): Promise<{ id: string; forwardedTo: number }> {
  const id = `app_${appKey}_${input.id}`;
  if (!(await getRepo().claimKv(`suite:evt:${id}`, new Date().toISOString()))) return { id, forwardedTo: 0 }; // repeat: already handled
  await recordDirectoryEvent(appKey, input.type, input.data);
  const event: SuiteEvent = { id, type: 'app.event', createdAt: new Date().toISOString(), source: appKey, data: { type: input.type, data: input.data ?? null } };
  const forwardedTo = await queueEvent(event, connectedSuiteApps(), appKey);
  await logActivity({ actor: suiteApp(appKey)?.name ?? appKey, source: 'api', kind: 'settings', action: 'suite_app_event', status: 'info', summary: `${suiteApp(appKey)?.name ?? appKey}: ${input.type} (passed to ${forwardedTo} app(s))` });
  return { id, forwardedTo };
}

/** Settings → Connected apps: each app, connected or not, and its delivery counts. */
export async function suiteStatus(): Promise<Array<{ key: string; name: string; repo: string; fr: string; en: string; connected: boolean; problem: string | null; subscribed: string[]; pending: number; failed: number; sent24h: number; lastError: string | null; restaurants: number }>> {
  const [docs, installs] = await Promise.all([getRepo().listDocs<OutboxItem>(OUTBOX, { limit: 2000 }), installCounts()]);
  const { suiteApps } = await import('./apps');
  return suiteApps().map((a) => {
    const mine = docs.filter((d) => d.data.app === a.key);
    const lastErr = mine.filter((d) => d.data.lastError).sort((x, y) => (y.at ?? '').localeCompare(x.at ?? ''))[0];
    return {
      key: a.key, name: a.name, repo: a.repo, fr: a.fr, en: a.en, connected: a.connected, problem: a.problem, subscribed: a.subscribed,
      pending: mine.filter((d) => d.data.status === 'pending').length, failed: mine.filter((d) => d.data.status === 'failed').length,
      sent24h: mine.filter((d) => d.data.status === 'sent').length, lastError: lastErr?.data.lastError ?? null, restaurants: installs[a.key] ?? 0,
    };
  });
}
