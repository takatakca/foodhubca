// DoorDash store-level tools built on the live-read endpoints (api.ts) and the existing publish / 86 / pause paths:
//   setDoorDashStoreStatus      PUT  /api/v1/stores/{id}/status with the full StoreActivationStatus (all six reasons, end_time OR duration)
//   setDoorDashMenuActive       hide / show the whole menu on DoorDash (menu `active` flag, certification: "deactivate and reactivate a menu")
//   verifyDoorDashHours         compare the regular + special (holiday) hours DoorDash serves with the ones Food Hub publishes
//   reconcileDoorDashAvailability   compare the 86'd items and options on DoorDash with Food Hub's, report the drift, optionally fix it
// Everything goes through the protected-store guard; menu-changing ones also honour "Do not touch" and the menu lock.
import { logActivity, type Actor, SYSTEM_ACTOR } from '../activity';
import { getAdapter } from '../adapters';
import { menuWithAlcoholRules } from '../alcohol/rules';
import { result } from '../config';
import { getHours, publishContext } from '../hours';
import { getMenuLanguages } from '../menu/language';
import { getBrandMenu } from '../menu/shared';
import { toDoorDashItemPolling, toDoorDashMenu } from '../menu/translate';
import { menuForLocation } from '../ops';
import { getRepo } from '../repo';
import type { ChannelResult, ChannelStore } from '../types';
import { ddRequest, getDoorDashAvailability, getDoorDashMenuDetails, getDoorDashStoreMenu, hhmm, type DdResult } from './api';
import { doorDashStoreRefusal } from './guard';

const KEY = 'doordash' as const;
const enc = encodeURIComponent;

// ---------------------------------------------------------------------------------------------- store status

export const STORE_STATUS_REASONS = ['out_of_business', 'operational_issues', 'delete_store', 'payment_issue', 'store_self_disabled_in_their_POS_portal', 'store_pos_connectivity_issues'] as const;
export type StoreStatusReason = (typeof STORE_STATUS_REASONS)[number];

export interface StoreStatusChange {
  active: boolean;
  /** Required when deactivating. */
  reason?: StoreStatusReason;
  notes?: string;
  /** ISO with an offset: the store comes back at this time. */
  endTime?: string;
  /** Or a duration. Sending both makes DoorDash ignore both and use its 14-day default, so that is refused here. */
  durationHours?: number;
  durationSecs?: number;
}

/** PUT /api/v1/stores/{id}/status. No end time and no duration = DoorDash reactivates the store by itself after 14 days. */
export async function setDoorDashStoreStatus(storeId: string, change: StoreStatusChange): Promise<DdResult> {
  if (!change.active) {
    if (!change.reason || !(STORE_STATUS_REASONS as readonly string[]).includes(change.reason)) return result(KEY, 'blocked', `Choose a reason: ${STORE_STATUS_REASONS.join(', ')}.`);
    if (change.endTime && (change.durationHours !== undefined || change.durationSecs !== undefined)) return result(KEY, 'blocked', 'Give an end time OR a duration, not both: DoorDash then ignores both and uses 14 days.');
    if (change.endTime && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(change.endTime)) return result(KEY, 'blocked', 'The end time must be an ISO date with a timezone offset, e.g. 2026-10-10T08:00:00-04:00.');
  }
  const body = change.active ? { is_active: true } : {
    is_active: false, reason: change.reason, merchant_supplied_id: storeId,
    ...(change.notes ? { notes: change.notes.slice(0, 500) } : {}),
    ...(change.endTime ? { end_time: change.endTime } : {}),
    ...(change.durationHours !== undefined ? { duration_in_hours: Math.max(0, Math.round(change.durationHours)) } : {}),
    ...(change.durationSecs !== undefined ? { duration_in_secs: Math.max(0, Math.round(change.durationSecs)) } : {}),
  };
  const res = await ddRequest({ method: 'PUT', path: `/api/v1/stores/${enc(storeId)}/status`, body, storeId, kind: 'write' });
  // 400 = banking information missing or no active POS menu: it keeps failing until fixed by hand, so say so.
  if (!res.ok && res.httpStatus === 400) return { ...res, message: `${res.message} — DoorDash refuses to (re)activate a store without valid banking information or an active menu: fix that in the Merchant Portal; retrying does not help.` };
  return res;
}

// ---------------------------------------------------------------------------------------------- menu on / off

/** Publishes the menu with its `active` flag on or off (hides / shows the whole menu on DoorDash). Respects every menu lock. */
export async function setDoorDashMenuActive(store: ChannelStore, active: boolean, actor: Actor = SYSTEM_ACTOR): Promise<ChannelResult> {
  const refused = doorDashStoreRefusal(store, 'menu');
  if (refused) return result(KEY, 'blocked', refused);
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return result(KEY, 'blocked', `No menu saved for ${store.brandName}.`);
  const hours = await getHours();
  const ctx = { ...(await publishContext(store.brandName, store.locationCode, hours)), language: (await getMenuLanguages()).doordash, menuActive: active };
  const local = await menuWithAlcoholRules(menuForLocation(menu, store.locationCode), store.locationCode, 'doordash');
  const res = await getAdapter('doordash').publishMenu(store, local, ctx);
  await getRepo().addJob({ kind: 'menu_push', channel: 'doordash', reference: res.reference ?? null, status: res.status === 'queued' ? 'queued' : res.ok ? 'done' : 'error', request: { brandName: store.brandName, storeId: store.id, channelStoreId: store.channelStoreId, menuActive: active }, result: { status: res.status, message: res.message, httpStatus: res.httpStatus ?? null } });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: active ? 'menu_on' : 'menu_off', status: res.ok ? 'success' : 'failed', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `Menu ${active ? 'shown' : 'hidden'} on DoorDash — ${store.brandName} · ${store.locationCode}${res.ok ? '' : ` (${res.message})`}` });
  return res;
}

// ---------------------------------------------------------------------------------------------- hours

export interface HoursCheck { ok: boolean; message: string; menus: number; diffs: string[] }

/** What Food Hub would publish as hours for this store right now (regular and special), normalised for comparison. */
async function expectedHours(store: ChannelStore) {
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return null;
  const ctx = await publishContext(store.brandName, store.locationCode, await getHours());
  const body = toDoorDashMenu(menu, store.channelStoreId, process.env.DOORDASH_PROVIDER_TYPE || '', 'verify', ctx);
  const open = body.open_hours.map((h) => `${h.day_index} ${hhmm(h.start_time)}-${hhmm(h.end_time)}`).sort();
  const special = body.special_hours.map((h) => (h.closed ? `${h.date} closed` : `${h.date} ${hhmm(h.start_time)}-${hhmm(h.end_time)}`)).sort();
  return { open, special };
}

/** Compares the hours DoorDash serves (GET menu_details) with the ones Food Hub publishes, including holiday (special) hours. */
export async function verifyDoorDashHours(store: ChannelStore): Promise<HoursCheck> {
  const refused = doorDashStoreRefusal(store, 'read');
  if (refused) return { ok: false, message: refused, menus: 0, diffs: [] };
  const live = await getDoorDashMenuDetails(store.channelStoreId);
  if (!live.ok || !live.data) return { ok: false, message: live.message, menus: 0, diffs: [] };
  const want = await expectedHours(store);
  if (!want) return { ok: false, message: `No menu saved for ${store.brandName}: Food Hub has no hours to compare.`, menus: live.data.length, diffs: [] };
  const active = live.data.filter((m) => m.active !== false);
  if (!active.length) return { ok: false, message: 'DoorDash has no active menu for this store.', menus: live.data.length, diffs: ['no active menu on DoorDash'] };
  const diffs: string[] = [];
  for (const m of active) {
    const haveOpen = new Set(m.openHours.map((h) => `${h.day} ${h.start}-${h.end}`));
    const haveSpecial = new Set(m.specialHours.map((h) => (h.closed ? `${h.date} closed` : `${h.date} ${h.start}-${h.end}`)));
    for (const w of want.open) if (!haveOpen.has(w)) diffs.push(`${m.name || m.id}: regular hours ${w} are not on DoorDash`);
    for (const h of haveOpen) if (!want.open.includes(h)) diffs.push(`${m.name || m.id}: DoorDash has regular hours ${h} that Food Hub does not publish`);
    for (const w of want.special) if (!haveSpecial.has(w)) diffs.push(`${m.name || m.id}: special / holiday hours ${w} are not on DoorDash`);
    // Only special days still ahead matter: DoorDash may keep past ones.
    const today = new Date().toISOString().slice(0, 10);
    for (const h of haveSpecial) if (h.slice(0, 10) >= today && !want.special.includes(h)) diffs.push(`${m.name || m.id}: DoorDash has special hours ${h} that Food Hub does not publish`);
  }
  return { ok: diffs.length === 0, message: diffs.length ? `${diffs.length} difference(s) between Food Hub and DoorDash.` : 'DoorDash serves exactly the hours Food Hub publishes (regular and holiday).', menus: active.length, diffs };
}

// ---------------------------------------------------------------------------------------------- availability reconciliation

export interface AvailabilityDrift {
  id: string; name: string; type: 'item' | 'item_option';
  /** What Food Hub says / what DoorDash serves. */
  foodHub: 'on' | 'off'; doordash: 'on' | 'off';
  detail?: string; fixed?: boolean;
}
export interface ReconcileResult { ok: boolean; message: string; checked: number; unknownOnDoorDash: number; drift: AvailabilityDrift[]; fixed: number }

/**
 * Compares what is 86'd on DoorDash (GET store_menu: `active` and `is_suspended` per item and option) with what Food Hub has
 * 86'd at this location (Item Availability Polling's own answer). Drift in both directions is reported with the start / end of
 * the DoorDash deactivation (GET item/availability, first 20). Options:
 *   fix      re-86 what Food Hub has off but DoorDash still sells (a lost push), through the normal 86 path (menu lock applies);
 *   restock  also switch back on what DoorDash has off but Food Hub has in stock (default: only reported — a person may have
 *            86'd it on the DoorDash tablet because the kitchen ran out).
 */
export async function reconcileDoorDashAvailability(store: ChannelStore, opts: { fix?: boolean; restock?: boolean; actor?: Actor } = {}): Promise<ReconcileResult> {
  const actor = opts.actor ?? SYSTEM_ACTOR;
  const refused = doorDashStoreRefusal(store, opts.fix || opts.restock ? 'menu' : 'read');
  if (refused) return { ok: false, message: refused, checked: 0, unknownOnDoorDash: 0, drift: [], fixed: 0 };
  const menu = await getBrandMenu(store.brandName);
  if (!menu) return { ok: false, message: `No menu saved for ${store.brandName}.`, checked: 0, unknownOnDoorDash: 0, drift: [], fixed: 0 };
  const live = await getDoorDashStoreMenu(store.channelStoreId);
  if (!live.ok || !live.data) return { ok: false, message: live.message, checked: 0, unknownOnDoorDash: 0, drift: [], fixed: 0 };

  const local = await menuWithAlcoholRules(menuForLocation(menu, store.locationCode), store.locationCode, 'doordash');
  const off = new Set(toDoorDashItemPolling(local).map((o) => `${o.type}:${o.merchant_supplied_id}`));
  const known = new Set<string>([...local.items.map((i) => `item:${i.ref}`), ...local.modifierGroups.flatMap((g) => g.modifiers.map((m) => `item_option:${m.ref}`))]);
  const drift: AvailabilityDrift[] = [];
  let unknown = 0;
  for (const e of live.data.entries) {
    const key = `${e.type}:${e.id}`;
    if (!known.has(key)) { unknown++; continue; }
    const ddOff = !e.active || e.suspended;
    const fhOff = off.has(key);
    if (ddOff !== fhOff) drift.push({ id: e.id, name: e.name, type: e.type, foodHub: fhOff ? 'off' : 'on', doordash: ddOff ? 'off' : 'on' });
  }
  // The window of the DoorDash deactivation (a timed 86 ends by itself), for the first few.
  for (const d of drift.filter((x) => x.doordash === 'off').slice(0, 20)) {
    const a = await getDoorDashAvailability(store.channelStoreId, d.id, d.type, true);
    if (a.ok && a.data) d.detail = a.data.end ? `off on DoorDash until ${a.data.end}` : 'off on DoorDash (no end time)';
  }
  let fixed = 0;
  if (opts.fix || opts.restock) {
    const adapter = getAdapter('doordash');
    const push = async (list: AvailabilityDrift[], available: boolean) => {
      for (const kind of ['item', 'item_option'] as const) {
        const ids = list.filter((d) => d.type === kind).map((d) => d.id);
        if (!ids.length) continue;
        const res = await adapter.setItemAvailability(store, ids, available, undefined, kind === 'item' ? 'item' : 'modifier');
        if (res.ok) for (const d of list.filter((x) => x.type === kind)) { d.fixed = true; fixed++; }
      }
    };
    if (opts.fix) await push(drift.filter((d) => d.foodHub === 'off' && d.doordash === 'on'), false);
    if (opts.restock) await push(drift.filter((d) => d.foodHub === 'on' && d.doordash === 'off'), true);
  }
  const message = drift.length ? `${drift.length} difference(s) in item availability${fixed ? `, ${fixed} fixed` : ''}.` : 'Item availability on DoorDash matches Food Hub.';
  await logActivity({ actor: actor.name, source: actor.source, kind: 'item_availability', action: 'doordash_reconcile', status: drift.length && !fixed ? 'info' : 'success', channel: 'doordash', brandName: store.brandName, locationCode: store.locationCode, storeId: store.id,
    summary: `DoorDash availability check — ${store.brandName} · ${store.locationCode}: ${message}`, detail: { drift: drift.slice(0, 50), checked: live.data.entries.length } });
  return { ok: true, message, checked: live.data.entries.length, unknownOnDoorDash: unknown, drift, fixed };
}
