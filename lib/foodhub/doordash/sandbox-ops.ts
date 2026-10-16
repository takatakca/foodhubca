// DoorDash sandbox tests: the DoorDash-facing side of a test order or of the test store, with the SAME DoorDash calls a
// real one gets (doorDashAdapter: confirm with prep_time, reject with DoorDash's failure codes, ready, merchant cancel,
// menu push, item / option availability, store open / closed). Nothing here touches the orders table, Clover, the
// printers, the kitchen screens, Watchtower, the activity feed or the reports: the test list lives in its own KV document
// (doordash/sandbox.ts). The DoorDash calls are refused for any store that is not a listed test store.
import crypto from 'node:crypto';
import { doorDashAdapter } from '../adapters/doordash';
import { menuWithAlcoholRules } from '../alcohol/rules';
import { getCatalog } from '../catalog';
import { nowIso } from '../config';
import { getHours, publishContext } from '../hours';
import { getMenuLanguages } from '../menu/language';
import { isMenuLocked } from '../menu/lock';
import { getBrandMenu } from '../menu/shared';
import { menuForLocation } from '../ops';
import { prepFor } from '../prep';
import { CANCEL_REASON_LABELS, type CancelReason, type ChannelResult, type NormalizedOrder, type OrderStatus, type StoredOrder } from '../types';
import {
  SANDBOX_CLIENT_PREFIX, addSandboxEvent, addSandboxLog, findSandboxOrder, readSandboxConfig, readSandboxState, sandboxStoreFor, writeSandboxState,
  type SandboxConfig, type SandboxOrder, type SandboxOrderStatus, type SandboxState,
} from './sandbox';

export type SandboxAction = 'confirm' | 'reject' | 'ready' | 'cancel';
export interface SandboxOutcome { ok: boolean; message: string; order?: SandboxOrder }

/** Read, change and save the test list in one go (re-read right before writing, so two webhooks do not erase each other). */
export async function updateSandboxState<T>(fn: (s: SandboxState) => T): Promise<T> {
  const s = await readSandboxState();
  const out = fn(s);
  await writeSandboxState(s);
  return out;
}

const STATUS_FOR: Record<SandboxOrderStatus, OrderStatus> = { received: 'new', confirmed: 'accepted', failed: 'cancelled', ready: 'ready', cancelled: 'cancelled' };

/** A test order shaped like a stored order, only for the DoorDash adapter's payload builders (never stored as one). */
export function sandboxAsStoredOrder(o: SandboxOrder, cfg: SandboxConfig, readyTarget?: string): StoredOrder {
  const base: NormalizedOrder = o.order ?? { channel: 'doordash', marketplace: 'doordash', externalOrderId: o.id, channelStoreId: o.storeId, placedAt: o.receivedAt, fulfillment: 'delivery', currency: 'CAD', subtotal: 0, tax: 0, deliveryFee: 0, tip: 0, discount: 0, total: 0, lines: [], raw: null };
  return {
    ...base, id: o.clientOrderId, externalOrderId: o.id, posOrderId: o.clientOrderId, brandName: cfg.brandName ?? base.brandName ?? '', locationCode: cfg.locationCode ?? '',
    status: STATUS_FOR[o.status], ...(readyTarget ? { timeline: { readyTarget } } : {}), createdAt: o.receivedAt, updatedAt: o.updatedAt,
  };
}

/** A new test order from DoorDash's Order Create (or the same order delivered again). */
export async function recordSandboxOrder(n: NormalizedOrder, reason: string): Promise<{ order: SandboxOrder; duplicate: boolean; cancelledBefore: boolean }> {
  return updateSandboxState((s) => {
    const existing = findSandboxOrder(s, n.externalOrderId);
    if (existing && !existing.placeholder) {
      addSandboxEvent(existing, 'Order Create delivered again — ignored (already received).');
      return { order: existing, duplicate: true, cancelledBefore: false };
    }
    const at = nowIso();
    // The raw payload is left out: the test list stays small (DoorDash's own payload is in the webhook inbox).
    const kept: NormalizedOrder = { ...n, raw: null };
    const order: SandboxOrder = existing
      ? { ...existing, placeholder: false, order: kept, displayId: n.displayId, storeId: n.channelStoreId, reason }
      : { id: n.externalOrderId, clientOrderId: `${SANDBOX_CLIENT_PREFIX}${crypto.randomUUID().slice(0, 12)}`, displayId: n.displayId, storeId: n.channelStoreId, reason, status: 'received', order: kept, receivedAt: at, updatedAt: at, events: [] };
    addSandboxEvent(order, `TEST order received (${reason}) — not sent to Clover, not printed, no kitchen alert.`);
    s.orders = [order, ...s.orders.filter((o) => o.id !== order.id)];
    addSandboxLog(s, { kind: 'order', text: `Test order #${n.displayId || n.externalOrderId.slice(0, 8)} received for store ${n.channelStoreId || '(none)'}`, storeId: n.channelStoreId || null });
    return { order, duplicate: false, cancelledBefore: order.status === 'cancelled' };
  });
}

const ALLOWED: Record<SandboxAction, SandboxOrderStatus[]> = { confirm: ['received'], reject: ['received'], ready: ['confirmed'], cancel: ['confirmed', 'ready'] };
const AFTER: Record<SandboxAction, SandboxOrderStatus> = { confirm: 'confirmed', reject: 'failed', ready: 'ready', cancel: 'cancelled' };
const LABEL: Record<SandboxAction, string> = { confirm: 'Confirmed on DoorDash', reject: 'Rejected on DoorDash', ready: 'Marked ready on DoorDash', cancel: 'Cancelled on DoorDash' };

/**
 * One DoorDash call on a test order: confirm (PATCH order success + prep_time), reject (PATCH fail + DoorDash's failure
 * reason and errors[]), ready (order_ready_for_pickup), cancel (merchant cancellation, only once DoorDash allowlisted it).
 */
export async function runSandboxOrderAction(orderId: string, action: SandboxAction, opts: { reason?: string; reasonCode?: CancelReason; details?: string; by?: string } = {}): Promise<SandboxOutcome> {
  const state = await readSandboxState();
  const o = findSandboxOrder(state, orderId, orderId);
  if (!o) return { ok: false, message: `No sandbox test order ${orderId}.` };
  if (!ALLOWED[action].includes(o.status)) return { ok: false, message: `This test order is ${o.status}: “${action}” is not possible now.`, order: o };
  // Po Poulet NDG and every locked store: never touched, not even by a test.
  if (o.storeId && isMenuLocked({ channel: 'doordash', channelStoreId: o.storeId, meta: {} })) {
    return { ok: false, message: `Not sent: store ${o.storeId} is protected. Food Hub never touches it.`, order: o };
  }
  const cfg = await readSandboxConfig();
  let res: ChannelResult;
  if (action === 'confirm') {
    const prep = await prepFor(cfg.locationCode || null);
    const ready = new Date(Date.now() + prep.minutes * 60_000).toISOString();
    res = await doorDashAdapter.acceptOrder(sandboxAsStoredOrder(o, cfg, ready), o.clientOrderId);
  } else if (action === 'reject') {
    const text = opts.reasonCode ? `${CANCEL_REASON_LABELS[opts.reasonCode]}${opts.details ? ` — ${opts.details}` : ''}` : opts.reason || 'Other';
    res = await doorDashAdapter.denyOrder(sandboxAsStoredOrder(o, cfg), text);
  } else if (action === 'ready') {
    res = await doorDashAdapter.markReady(sandboxAsStoredOrder(o, cfg), o.clientOrderId);
  } else {
    res = await doorDashAdapter.cancelOrder(sandboxAsStoredOrder(o, cfg), opts.reasonCode ?? 'other', opts.details);
  }
  const message = res.ok ? `${LABEL[action]}${opts.by ? ` (${opts.by})` : ''}` : `${LABEL[action]} — not done: ${res.message}`;
  const saved = await updateSandboxState((s) => {
    const cur = findSandboxOrder(s, o.id);
    if (!cur) return undefined;
    // A DoorDash cancellation that landed during the call wins: never write "confirmed" over it.
    if (res.ok && cur.status !== 'cancelled') cur.status = AFTER[action];
    addSandboxEvent(cur, message, res.ok);
    return cur;
  });
  return { ok: res.ok, message, order: saved ?? o };
}

/** Auto-confirm on arrival, as auto-accept does for a real order once Clover has it (here: no Clover, by design). */
export async function autoConfirmSandboxOrder(order: SandboxOrder): Promise<SandboxOutcome | null> {
  const cfg = await readSandboxConfig();
  if (!cfg.autoConfirm || order.status !== 'received') return null;
  return runSandboxOrderAction(order.id, 'confirm', { by: 'automatic' });
}

/** The menu the test store gets, built exactly like a real publish / menu pull: location prices, 86s, alcohol rules, hours. */
export async function sandboxMenuPayloadParts(storeId: string) {
  const store = await sandboxStoreFor(storeId);
  if (!store) return { error: `${storeId} is not a DoorDash test store (DOORDASH_SANDBOX_STORE_IDS).` } as const;
  if (!store.brandName) return { error: 'Choose the brand whose menu the DoorDash test store gets (DoorDash sandbox tests → Test store menu).' } as const;
  const menu = await getBrandMenu(store.brandName);
  if (!menu || !menu.items.length) return { error: `No menu saved for ${store.brandName} yet.` } as const;
  const loc = store.locationCode || (await getCatalog()).locations[0]?.code || '';
  const languages = await getMenuLanguages();
  const ctx = { ...(await publishContext(store.brandName, loc, await getHours())), language: languages.doordash };
  const local = await menuWithAlcoholRules(menuForLocation(menu, loc), loc, 'doordash');
  return { store: { ...store, locationCode: loc }, menu: local, ctx } as const;
}

/** Sends the menu to the DoorDash test store (POST, or PATCH once DoorDash returned the menu id). */
export async function pushSandboxMenu(storeId: string): Promise<SandboxOutcome> {
  const parts = await sandboxMenuPayloadParts(storeId);
  if ('error' in parts) return { ok: false, message: parts.error ?? 'Menu not available.' };
  const res = await doorDashAdapter.publishMenu(parts.store, parts.menu, parts.ctx);
  const message = res.ok ? `Menu of ${parts.store.brandName} sent to the test store ${storeId} — DoorDash answers on Menu Status (reference ${res.reference ?? '?'})` : `Menu not sent to the test store ${storeId}: ${res.message}`;
  await updateSandboxState((s) => addSandboxLog(s, { kind: 'menu_push', text: message, ok: res.ok, storeId }));
  return { ok: res.ok, message };
}

/** Item or option on / off at the DoorDash test store (the same PUT …/items/status a real 86 sends). */
export async function setSandboxItem(storeId: string, ref: string, available: boolean, kind: 'item' | 'modifier' = 'item'): Promise<SandboxOutcome> {
  const store = await sandboxStoreFor(storeId);
  if (!store) return { ok: false, message: `${storeId} is not a DoorDash test store (DOORDASH_SANDBOX_STORE_IDS).` };
  if (!ref.trim()) return { ok: false, message: 'Give the item (or option) merchant_supplied_id.' };
  const res = await doorDashAdapter.setItemAvailability(store, [ref.trim()], available, undefined, kind);
  const message = `${kind === 'modifier' ? 'Option' : 'Item'} ${ref.trim()} ${available ? 'back on' : 'off (86)'} at the test store${res.ok ? '' : ` — not done: ${res.message}`}`;
  await updateSandboxState((s) => addSandboxLog(s, { kind: 'item_availability', text: message, ok: res.ok, storeId }));
  return { ok: res.ok, message };
}

/** The DoorDash test store open / paused (the same PUT …/status a real pause sends). */
export async function setSandboxStoreOnline(storeId: string, online: boolean): Promise<SandboxOutcome> {
  const store = await sandboxStoreFor(storeId);
  if (!store) return { ok: false, message: `${storeId} is not a DoorDash test store (DOORDASH_SANDBOX_STORE_IDS).` };
  const res = await doorDashAdapter.setStoreOnline(store, online, undefined, 'Sandbox test from TAKATAK Food Hub');
  const message = `Test store ${storeId} ${online ? 'reopened' : 'paused'}${res.ok ? '' : ` — not done: ${res.message}`}`;
  await updateSandboxState((s) => {
    if (res.ok) s.paused = { ...s.paused, [storeId]: !online };
    addSandboxLog(s, { kind: 'store_status', text: message, ok: res.ok, storeId });
  });
  return { ok: res.ok, message };
}

/** Empties the test list (orders and history). Nothing else is touched. */
export async function clearSandboxTests(): Promise<void> {
  await updateSandboxState((s) => { s.orders = []; s.log = []; });
}
