// Observes persisted operational state. No provider/order/printing path calls this network client.
import crypto from 'node:crypto';
import { getRepo, type OrderChangeCursor } from '../repo';
import type { StoredOrder } from '../types';
import { configuredControlPlane, type ControlPlaneConfig, type MerchantBinding } from './config';
import { ControlPlaneError, deliverWireEvent, parseWireEvent, readMerchantObservation, type MerchantObservation, type WireEvent } from './client';

export const CONTROL_PLANE_OUTBOX = 'control_plane_outbox';
export const CONTROL_PLANE_MERCHANTS = 'control_plane_merchants';
export const CONTROL_PLANE_TICK = 'control_plane:last';
export const CHANGE_PAGE = 100;
export const MAX_SENDS = 4;
export interface ObservationCursor { startedAt: string; after?: OrderChangeCursor }
export interface MerchantState { last: MerchantObservation; lastGood?: MerchantObservation; failures: number; nextAt: string }
export interface OutboxEntry { bindingKey: string; origin: string; instanceTenantId: string; rawBody: string; state: 'pending' | 'sent' | 'failed'; attempts: number; nextAt: string; createdAt: string; sentAt?: string; error?: string }
export interface TickReport { at: string; queued: number; sent: number; failed: number; deferred: number; observed: number; moreChanges: boolean; skipped?: string }

const NS = Buffer.from('6ba7b8119dad11d180b400c04fd430c8', 'hex');
/** RFC4122 UUIDv5, namespaced by source instance + explicitly mapped merchant + event kind + local order UUID. */
export function stableUuid(name: string): string {
  const bytes = crypto.createHash('sha1').update(NS).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = bytes.toString('hex');return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const cursorKey = (config: ControlPlaneConfig) => `control-plane:cursor:${config.fingerprint}`;
const canonicalKey = (id: string) => `control-plane:canonical:${id}`;
const pendingKey = (binding: MerchantBinding) => `pending:${binding.key}`;
const backoff = (attempts: number) => Math.min(3600_000, 30_000 * 2 ** Math.min(7, Math.max(0, attempts - 1)));

export function wireEvent(config: ControlPlaneConfig, binding: MerchantBinding, order: StoredOrder, kind: WireEvent['event_type']): WireEvent | null {
  // Completion is the actual persisted final state. Payment/acceptance/printing alone never imply fulfillment.
  if (kind === 'order.fulfilled' && order.status !== 'completed') return null;
  const occurredAt = kind === 'order.created' ? order.createdAt : order.timeline?.completedAt ?? order.updatedAt;
  if (!Number.isFinite(Date.parse(occurredAt))) return null;
  const base = ['foodhub', config.instanceTenantId, binding.localVendorId, binding.masterMerchantId, order.id].join('|');
  return { event_id: stableUuid(`${base}|${kind}`), event_type: kind, aggregate_type: 'order', aggregate_id: stableUuid(`${base}|order`), source_application: 'foodhub',
    payload: { local_vendor_id: binding.localVendorId, master_merchant_id: binding.masterMerchantId, occurred_at: occurredAt, counts: { orders: 1 } } };
}

async function enqueue(config: ControlPlaneConfig, binding: MerchantBinding, event: WireEvent, now: number): Promise<boolean> {
  const repo = getRepo();const rawBody = JSON.stringify(event);
  const canonical: OutboxEntry = { bindingKey: binding.key, origin: config.url, instanceTenantId: config.instanceTenantId, rawBody, state: 'pending', attempts: 0, nextAt: new Date(now).toISOString(), createdAt: new Date(now).toISOString() };
  // Claim freezes the first body, including its key order/timestamp. A crash before document creation is repairable
  // when the unchanged observer cursor revisits this order. Concurrent retries can only resend identical bytes.
  const claimed = await repo.claimKv(canonicalKey(event.event_id), canonical);
  const frozen = claimed ? canonical : await repo.getKv<OutboxEntry>(canonicalKey(event.event_id));
  const saved = frozen && parseWireEvent(frozen.rawBody);
  if (!frozen || frozen.bindingKey !== binding.key || frozen.origin !== config.url || frozen.instanceTenantId !== config.instanceTenantId || !saved
    || saved.event_id !== event.event_id || saved.aggregate_id !== event.aggregate_id || saved.event_type !== event.event_type
    || saved.payload.local_vendor_id !== binding.localVendorId || saved.payload.master_merchant_id !== binding.masterMerchantId) throw new Error('canonical_event_mismatch');
  if (await repo.getDoc<OutboxEntry>(CONTROL_PLANE_OUTBOX, event.event_id)) return false;
  await repo.putDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX, [{ id: event.event_id, key: pendingKey(binding), at: frozen.createdAt, data: frozen }]);
  return true;
}

export async function observeOrders(config: ControlPlaneConfig, now = Date.now()): Promise<{ queued: number; observed: number; moreChanges: boolean }> {
  const repo = getRepo();const key = cursorKey(config);
  await repo.claimKv(key, { startedAt: new Date(now).toISOString() } satisfies ObservationCursor);
  const cursor = await repo.getKv<ObservationCursor>(key);
  if (!cursor || !Number.isFinite(Date.parse(cursor.startedAt))) throw new Error('invalid_observer_cursor');
  const rows = await repo.listChangedOrders({ since: cursor.startedAt, ...(cursor.after ? { after: cursor.after } : {}), through: new Date(now).toISOString(), limit: CHANGE_PAGE });
  let queued = 0;
  for (const order of rows) {
    const binding = config.merchants.find((b) => !!order.locationCode && b.locationCodes.includes(order.locationCode));
    if (!binding) continue;
    for (const kind of ['order.created', 'order.fulfilled'] as const) {
      const event = wireEvent(config, binding, order, kind);
      if (!event || Date.parse(event.payload.occurred_at) < Date.parse(cursor.startedAt) || Date.parse(event.payload.occurred_at) > now + 300_000) continue;
      if (await enqueue(config, binding, event, now)) queued++;
    }
  }
  // Never advance past an event whose durable enqueue failed. The exception leaves this cursor unchanged.
  const last = rows.at(-1);
  if (last) await repo.setKv(key, { startedAt: cursor.startedAt, after: { at: last.updatedAt, id: last.id } } satisfies ObservationCursor);
  return { queued, observed: rows.length, moreChanges: rows.length === CHANGE_PAGE };
}

async function refreshMerchant(config: ControlPlaneConfig, binding: MerchantBinding, now: number, fetcher: typeof fetch): Promise<MerchantState | null> {
  const repo = getRepo();const previous = (await repo.getDoc<MerchantState>(CONTROL_PLANE_MERCHANTS, binding.key))?.data;
  if (previous && Date.parse(previous.nextAt) > now) return null;
  const last = await readMerchantObservation(config, binding, now, fetcher);
  const failures = last.verified ? 0 : (previous?.failures ?? 0) + 1;
  const delay = last.verified ? 30_000 : Math.max(last.retryAfterMs ?? 0, backoff(failures));
  const state: MerchantState = { last, ...(last.verified ? { lastGood: last } : previous?.lastGood ? { lastGood: previous.lastGood } : {}), failures, nextAt: new Date(now + delay).toISOString() };
  await repo.putDocs<MerchantState>(CONTROL_PLANE_MERCHANTS, [{ id: binding.key, key: binding.key, at: last.observedAt, data: state }]);
  return state;
}

async function drainBinding(config: ControlPlaneConfig, binding: MerchantBinding, now: number, budget: number, fetcher: typeof fetch): Promise<{ sent: number; failed: number; deferred: number; attempted: number }> {
  const repo = getRepo();const pending = await repo.listDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX, { keys: [pendingKey(binding)], limit: 1000 });
  pending.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '') || a.id.localeCompare(b.id));
  let sent = 0;let failed = 0;let deferred = 0;let tried = 0;
  for (const doc of pending) {
    const item = doc.data;
    if (item.state !== 'pending' || Date.parse(item.nextAt) > now) { deferred++;continue; }
    if (tried >= budget) { deferred++;continue; }
    const event = parseWireEvent(item.rawBody);
    if (item.bindingKey !== binding.key || item.origin !== config.url || item.instanceTenantId !== config.instanceTenantId) { deferred++;continue; }
    tried++;
    let error: ControlPlaneError | null = null;
    if (!event || event.event_id !== doc.id || event.payload.local_vendor_id !== binding.localVendorId || event.payload.master_merchant_id !== binding.masterMerchantId) error = new ControlPlaneError('invalid_outbox_scope', true);
    else { try { await deliverWireEvent(config, item.rawBody, fetcher); } catch (e) { error = e instanceof ControlPlaneError ? e : new ControlPlaneError('unavailable'); } }
    const attempts = item.attempts + 1;
    if (!error) {
      await repo.putDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX, [{ ...doc, key: 'sent', data: { ...item, state: 'sent', attempts, sentAt: new Date(now).toISOString(), error: undefined } }]);sent++;
    } else {
      const permanent = error.permanent;
      await repo.putDocs<OutboxEntry>(CONTROL_PLANE_OUTBOX, [{ ...doc, key: permanent ? 'failed' : pendingKey(binding), data: { ...item, state: permanent ? 'failed' : 'pending', attempts,
        error: error.code, nextAt: new Date(now + Math.max(backoff(attempts), error.retryAfterMs ?? 0)).toISOString() } }]);
      if (permanent) failed++;else deferred++;
    }
  }
  return { sent, failed, deferred, attempted: tried };
}

let running = false;
/** Only background instrumentation/cron call this. All errors remain reporting failures, never order failures. */
export async function tickControlPlane(now = Date.now(), fetcher: typeof fetch = fetch): Promise<TickReport> {
  const report: TickReport = { at: new Date(now).toISOString(), queued: 0, sent: 0, failed: 0, deferred: 0, observed: 0, moreChanges: false };
  const { config } = configuredControlPlane();
  if (!config) return { ...report, skipped: 'not_configured' };
  if (running) return { ...report, skipped: 'already_running' };
  running = true;
  let repo: ReturnType<typeof getRepo> | undefined;
  try {
    repo = getRepo();
    if (process.env.NODE_ENV === 'production' && repo.mode !== 'supabase') return { ...report, skipped: 'durable_storage_required' };
    Object.assign(report, await observeOrders(config, now));
    const rotateKey = `control-plane:rotate:${config.fingerprint}`;
    const start = (await repo.getKv<number>(rotateKey)) ?? 0;
    const groups = Array.from({ length: Math.min(2, config.merchants.length) }, (_, i) => config.merchants[(start + i) % config.merchants.length]);
    await repo.setKv(rotateKey, (start + groups.length) % config.merchants.length);
    let attempted = 0;
    for (const binding of groups) {
      const state = await refreshMerchant(config, binding, now, fetcher);
      // A request-scoped successful read validates the expected existing source/master binding before sending.
      if (!state?.last.verified) continue;
      const result = await drainBinding(config, binding, now, Math.max(0, MAX_SENDS - attempted), fetcher);
      attempted += result.attempted;
      report.sent += result.sent;report.failed += result.failed;report.deferred += result.deferred;
    }
    await repo.setKv(`${CONTROL_PLANE_TICK}:${config.fingerprint}`, report);
    return report;
  } catch {
    const failed = { ...report, skipped: 'reporting_unavailable' };
    if (repo) await repo.setKv(`${CONTROL_PLANE_TICK}:${config.fingerprint}`, failed).catch(() => undefined);
    return failed;
  } finally { running = false; }
}
