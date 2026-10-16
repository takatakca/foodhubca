// Kitchen order tools — store status from the kitchen: Normal / Busy (prep minutes) / Paused (which channels, which
// brands, how long, why). Prep goes to the existing /api/foodhub/prep; pause / reopen goes to the kitchen route
// POST /api/foodhub/order-tools/kitchen/status, which re-checks every store on the SERVER (splitKitchenRequest) before
// the existing store-status logic runs. This file decides what to show and which stores may be sent.
//
// Locked, shown but never sent: a store marked "Do not touch" (meta.doNotTouch) and a protected DoorDash store
// (FORBIDDEN_STORE_IDS — Po Poulet NDG — or the built-in menu lock). Relay stores ("relay:<id>") are hidden: the
// platform's API does not know them, so a pause could not reach them anyway.
//
// Pure (no server import): the screen, the route and the tests all use it. The forbidden ids are passed in (the server
// sends FORBIDDEN_STORE_IDS), so this file never carries a store id itself.
import { localParts } from '../time';
import type { ChannelKey, ChannelStore } from '../types';

/** Same prefix as RELAY_STORE_PREFIX in adapters/relay.ts (not imported: that file is server-only). */
const RELAY_PREFIX = 'relay:';
/** Same text as HOLIDAY_REASON in ops.ts (not imported: that file is server-only) — the holiday auto-pause. */
export const HOLIDAY_PAUSE_REASON = 'Holiday closure';

export type KitchenStore = Pick<ChannelStore, 'id' | 'channel' | 'channelStoreId' | 'brandName' | 'locationCode' | 'online'> & {
  pausedUntil?: string | null;
  meta?: Record<string, unknown>;
  menuLock?: { locked: boolean; source?: string };
};

export type LockReason = 'forbidden' | 'do_not_touch';
export type ClassifiedStore = KitchenStore & { locked: boolean; lockReason?: LockReason };

export interface KitchenStores {
  stores: ClassifiedStore[];
  /** Channels with at least one store at this kitchen (relay stores excluded), in a stable order. */
  channels: ChannelKey[];
  /** Brands with at least one store at this kitchen, alphabetical. */
  brands: string[];
}

const CHANNEL_ORDER: ChannelKey[] = ['uber_eats', 'doordash', 'skip', 'tgtg'];

export function isRelayKitchenStore(s: Pick<ChannelStore, 'channelStoreId'>): boolean {
  return String(s.channelStoreId ?? '').startsWith(RELAY_PREFIX);
}

/** Why this store is locked for kitchen pauses, or null. */
export function lockReasonOf(s: KitchenStore, forbiddenIds: Iterable<string>): LockReason | null {
  const forbidden = new Set([...forbiddenIds].map(String));
  if (s.channel === 'doordash') {
    const ids = [s.channelStoreId, s.meta?.platformStoreId].filter((x) => x !== undefined && x !== null).map((x) => String(x).trim());
    if (ids.some((id) => forbidden.has(id)) || s.menuLock?.source === 'built_in') return 'forbidden';
  }
  if (s.meta?.doNotTouch === true) return 'do_not_touch';
  return null;
}

/** The kitchen's stores (relay hidden), each marked locked or not, plus the channels and brands present. */
export function kitchenStores(all: KitchenStore[], locationCode: string, forbiddenIds: Iterable<string>): KitchenStores {
  const ids = [...forbiddenIds];
  const stores = all
    .filter((s) => s.locationCode === locationCode && !isRelayKitchenStore(s))
    .map((s) => { const why = lockReasonOf(s, ids); return why ? { ...s, locked: true, lockReason: why } : { ...s, locked: false }; })
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel));
  const channels = CHANNEL_ORDER.filter((c) => stores.some((s) => s.channel === c));
  const brands = [...new Set(stores.map((s) => s.brandName))].sort((a, b) => a.localeCompare(b));
  return { stores, channels, brands };
}

/** Store ids a pause sends: unlocked stores on the ticked channels and brands. Never a locked one. */
export function pauseTargets(k: KitchenStores, pick: { channels: ChannelKey[]; brands: string[] }): string[] {
  return k.stores.filter((s) => !s.locked && pick.channels.includes(s.channel) && pick.brands.includes(s.brandName)).map((s) => s.id);
}

/** Business day (YYYY-MM-DD, hub time zone) — same format as meta.holidayPause. */
export function localDay(ms = Date.now()): string {
  const p = localParts(ms);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * Why "Tout rouvrir" must leave this paused store alone, or null. The kitchen reopens its own pauses only:
 *   - holiday: the holiday auto-pause (meta.holidayPause is today, or the pause reason is the holiday one);
 *   - platform: the platform itself shut or closed the store (DoorDash deactivation webhook, outside menu hours…).
 */
export type ResumeHold = 'holiday' | 'platform';
export function resumeHoldOf(s: Pick<KitchenStore, 'meta'>, today: string): ResumeHold | null {
  const ps = s.meta?.platformStatus as { state?: string; detail?: string } | undefined;
  if (s.meta?.holidayPause === today || ps?.detail === HOLIDAY_PAUSE_REASON) return 'holiday';
  if (ps?.state === 'deactivated' || ps?.state === 'closed') return 'platform';
  return null;
}

/** Store ids "Tout rouvrir" sends: unlocked paused stores of the kitchen, minus holiday and platform closures. */
export function resumeTargets(k: KitchenStores, today = localDay()): string[] {
  return k.stores.filter((s) => !s.locked && s.online === false && !resumeHoldOf(s, today)).map((s) => s.id);
}

/** Paused stores "Tout rouvrir" leaves closed, with the reason (shown in the sheet). */
export function resumeHeld(k: KitchenStores, today = localDay()): Map<string, ResumeHold> {
  const out = new Map<string, ResumeHold>();
  for (const s of k.stores) {
    const hold = !s.locked && s.online === false ? resumeHoldOf(s, today) : null;
    if (hold) out.set(s.id, hold);
  }
  return out;
}

// ---------- server-side refusal (POST /api/foodhub/order-tools/kitchen/status) ----------

export type NotSentReason = LockReason | ResumeHold | 'other_kitchen' | 'unknown';

/**
 * Splits the store ids a kitchen asked to pause / reopen into the ones that may be sent and the ones refused, with the
 * same rules the sheet shows. The route runs it on the SERVER, so a stale tablet or a hand-made request never reaches a
 * protected store. Pass stores carrying menuLock (menuLockOf) so the built-in lock counts too.
 */
export function splitKitchenRequest(
  ids: string[], stores: KitchenStore[], opts: { locationCode: string; online: boolean; forbiddenIds: Iterable<string>; today: string },
): { send: string[]; notSent: Array<{ storeId: string; reason: NotSentReason }> } {
  const forbidden = [...opts.forbiddenIds];
  const byId = new Map(stores.map((s) => [s.id, s]));
  const send: string[] = [];
  const notSent: Array<{ storeId: string; reason: NotSentReason }> = [];
  for (const id of [...new Set(ids.map(String))]) {
    const s = byId.get(id);
    let reason: NotSentReason | null = null;
    if (!s) reason = 'unknown';
    else reason = lockReasonOf(s, forbidden) // a protected store is refused first, wherever it is mapped
      ?? (s.locationCode !== opts.locationCode || isRelayKitchenStore(s) ? 'other_kitchen' : opts.online ? resumeHoldOf(s, opts.today) : null);
    if (reason) notSent.push({ storeId: id, reason }); else send.push(id);
  }
  return { send, notSent };
}

// ---------- summary (the header button) ----------

export interface PrepLike { isBusy: boolean; normal: number; busy: number }

export interface KitchenSummary {
  kind: 'normal' | 'busy' | 'paused';
  /** Prep minutes in force (busy or normal). */
  minutes: number;
  /** Paused / total among the kitchen's unlocked stores. */
  paused: number;
  total: number;
  /** Latest end of a timed pause (ISO), null when a paused store has no end. */
  until: string | null;
}

export function summarizeKitchen(prep: PrepLike | null | undefined, k: Pick<KitchenStores, 'stores'>): KitchenSummary {
  const p = { isBusy: false, normal: 15, busy: 25, ...(prep ?? {}) };
  const minutes = p.isBusy ? p.busy : p.normal;
  const mine = k.stores.filter((s) => !s.locked);
  const pausedStores = mine.filter((s) => s.online === false);
  const ends = pausedStores.map((s) => (s.pausedUntil ? Date.parse(s.pausedUntil) : NaN));
  const until = pausedStores.length && ends.every(Number.isFinite) ? new Date(Math.max(...ends)).toISOString() : null;
  const kind: KitchenSummary['kind'] = pausedStores.length ? 'paused' : p.isBusy ? 'busy' : 'normal';
  return { kind, minutes, paused: pausedStores.length, total: mine.length, until };
}

/** Header text, French first: "Ouvert · Normal 15 min", "Occupé · 25 min", "En pause jusqu'à 18:30 (3/5)". */
export function kitchenStatusText(s: KitchenSummary, lang: 'fr' | 'en', time: (iso: string) => string): string {
  if (s.kind === 'paused') {
    const n = `(${s.paused}/${s.total})`;
    if (s.until) return lang === 'fr' ? `En pause jusqu’à ${time(s.until)} ${n}` : `Paused until ${time(s.until)} ${n}`;
    return lang === 'fr' ? `En pause ${n}` : `Paused ${n}`;
  }
  if (s.kind === 'busy') return lang === 'fr' ? `Occupé · ${s.minutes} min` : `Busy · ${s.minutes} min`;
  return lang === 'fr' ? `Ouvert · Normal ${s.minutes} min` : `Open · Normal ${s.minutes} min`;
}

// ---------- choices ----------

export type PauseChoice = 15 | 30 | 60 | 'close';
export const PAUSE_CHOICES: PauseChoice[] = [15, 30, 60, 'close'];

/** Minutes a pause choice means; null when "until close" is not known (hours not set, or already closed). */
export function pauseMinutes(choice: PauseChoice, closesInMin: number | null | undefined): number | null {
  if (choice !== 'close') return choice;
  return closesInMin && closesInMin > 0 ? closesInMin : null;
}

/** Busy prep minutes after a ±5 tap, kept between 5 and 120. */
export function stepBusyMinutes(current: number, delta: number): number {
  return Math.min(120, Math.max(5, Math.round((Number(current) || 25) + delta)));
}

/** Pause reasons: the chip label (FR/EN) and the plain text the platforms receive (same wording as Stores → Pause). */
export const PAUSE_REASONS: Array<{ value: string; fr: string; en: string; text: string }> = [
  { value: 'busy', fr: 'Trop occupé', en: 'Too busy', text: 'Kitchen too busy' },
  { value: 'staff', fr: 'Manque de personnel', en: 'Short-staffed', text: 'Short-staffed' },
  { value: 'stock', fr: 'Rupture', en: 'Out of stock', text: 'Out of stock' },
  { value: 'tech', fr: 'Problème technique', en: 'Technical issue', text: 'Technical issue' },
];
