// "Statut maintenant": every kitchen, every brand, every platform store — open, paused (by whom), closed by the hours —
// and when it reopens. Read-only: pausing and resuming stay on /stores (stores-view.tsx); nothing here calls a platform.
import { isRelayStore } from '../adapters/relay';
import { getCatalog } from '../catalog';
import { effectiveHours, getHours, holidaysFor, isOpenAt, localDate } from '../hours';
import { deviceStatus, listDevices } from '../identity/devices';
import { HOLIDAY_REASON } from '../ops';
import { cloverWebsiteOrdersEnabled } from '../pos/clover-website-orders';
import { prepFor } from '../prep';
import { getRepo } from '../repo';
import { foodhubTimeZone } from '../time';
import type { ChannelKey, ChannelStore, PlatformState } from '../types';
import { AVAILABILITY_CHANNELS, GUARD_REASON, isLockedStore, platformStatusOf } from './common';
import { nextOpening, type Bilingual, type NextOpening } from './next-open';

export type { Bilingual };
/** 'manuel' = a channel Food Hub cannot pause by itself (Clover Online Ordering): the screen says what to do. */
export type ChannelState = PlatformState | 'manuel';
/** Who made the store unavailable: TAKATAK (dashboard), the platform, the tablet-off guard, or the hours. */
export type PausedBy = 'TAKATAK' | 'plateforme' | 'garde' | 'horaire';

export interface ChannelRow {
  storeId: string | null;
  channel: ChannelKey | 'clover_online';
  state: ChannelState;
  pausedUntil: string | null;
  by: PausedBy | null;
  /** ISO: end of the pause (or the next opening after it), or the next opening when closed by the hours. */
  reopensAt: string | null;
  /** Never paused or resumed by an automation ("do not touch", or a store the owner forbids). */
  locked: boolean;
  detail?: string;
  /** Instruction shown instead of a state (Clover Online Ordering). */
  text?: Bilingual;
}

export interface BrandBoard { name: string; nextOpening: NextOpening; channels: ChannelRow[] }
export interface KitchenSummary { kind: 'open' | 'paused' | 'closed'; count: number; label: Bilingual }
export interface KitchenBoard {
  code: string;
  name: string;
  prep: { normal: number; busy: number; isBusy: boolean; minutes: number };
  devices: { online: number; total: number; lastSeenAt: string | null };
  nextOpening: NextOpening;
  summary: KitchenSummary;
  brands: BrandBoard[];
}
export interface AvailabilityBoard { at: string; kitchens: KitchenBoard[] }

/** FOODHUB_CLOVER_WEBSITE_BRAND / _LOCATION: one value, or a JSON map per Clover merchant (all its values count). */
function envValues(key: string): string[] {
  const raw = String(process.env[key] ?? '').trim();
  if (!raw) return [];
  if (!raw.startsWith('{')) return [raw];
  try {
    return Object.values(JSON.parse(raw) as Record<string, unknown>).filter((v): v is string => typeof v === 'string' && Boolean(v.trim())).map((v) => v.trim());
  } catch {
    return [];
  }
}

/** Is this the brand Clover Online Ordering (the website) sells for this kitchen? */
export function isCloverWebsiteBrand(brandName: string, locationCode: string, brandsAtKitchen: string[]): boolean {
  if (!cloverWebsiteOrdersEnabled()) return false;
  const locations = envValues('FOODHUB_CLOVER_WEBSITE_LOCATION');
  if (locations.length && !locations.includes(locationCode)) return false;
  const brands = envValues('FOODHUB_CLOVER_WEBSITE_BRAND');
  if (brands.length) return brands.includes(brandName);
  // Not pinned: the website sells the kitchen's brand when it has only one.
  return brandsAtKitchen.length === 1 && brandsAtKitchen[0] === brandName;
}

/** One platform store's row. `opening` is the brand's opening (hours) at this kitchen. */
export function channelRow(store: ChannelStore, opening: NextOpening, reopenAfter: (ms: number) => number, now = Date.now()): ChannelRow {
  const ps = platformStatusOf(store);
  let state: ChannelState = ps?.state ?? (store.online ? 'online' : 'paused');
  // Online on the platform but outside the brand's hours: closed by the hours (the platform follows the published hours).
  if (state === 'online' && opening.known && !opening.openNow) state = 'closed';
  const pausedUntil = state !== 'online' && !store.online && store.pausedUntil ? store.pausedUntil : null;
  let by: PausedBy | null = null;
  if (state !== 'online') {
    if (ps?.detail === GUARD_REASON) by = 'garde';
    else if (ps?.detail === HOLIDAY_REASON || state === 'closed') by = 'horaire';
    else if (!ps || ps.source === 'dashboard') by = 'TAKATAK';
    else by = 'plateforme';
  }
  let reopensAt: number | null = null;
  if (state === 'closed') reopensAt = opening.nextOpenAt ?? null;
  else if (state === 'paused' && pausedUntil) {
    const until = Date.parse(pausedUntil);
    reopensAt = Number.isFinite(until) ? Math.max(until, until > now ? reopenAfter(until) : now) : null;
  }
  return {
    storeId: store.id, channel: store.channel, state, pausedUntil, by,
    reopensAt: reopensAt ? new Date(reopensAt).toISOString() : null,
    locked: isLockedStore(store),
    ...(ps?.detail ? { detail: ps.detail } : {}),
  };
}

export function kitchenSummary(brands: BrandBoard[], kitchenOpening: NextOpening): KitchenSummary {
  const rows = brands.flatMap((b) => b.channels).filter((r) => r.channel !== 'clover_online');
  const known = brands.length ? brands.every((b) => b.nextOpening.known) : kitchenOpening.known;
  const anyOpen = brands.length ? brands.some((b) => b.nextOpening.openNow) : kitchenOpening.openNow;
  if (known && !anyOpen) return { kind: 'closed', count: 0, label: { fr: 'Fermé (heures)', en: 'Closed (hours)' } };
  const paused = rows.filter((r) => r.state === 'paused' || r.state === 'deactivated').length;
  if (paused) return { kind: 'paused', count: paused, label: { fr: `${paused} en pause`, en: `${paused} paused` } };
  return { kind: 'open', count: 0, label: { fr: 'Tout ouvert', en: 'All open' } };
}

export async function availabilityBoard(filter: { locationCodes?: string[]; brandNames?: string[] } = {}, now = Date.now()): Promise<AvailabilityBoard> {
  const tz = foodhubTimeZone();
  const [catalog, hours, allStores, devices] = await Promise.all([getCatalog(), getHours(), getRepo().listStores(), listDevices().catch(() => [])]);
  const holidaysFrom = localDate(now - 86400_000, tz);
  const kitchens: KitchenBoard[] = [];
  for (const loc of catalog.locations.filter((l) => l.active && (!filter.locationCodes?.length || filter.locationCodes.includes(l.code)))) {
    // Relay stores only receive orders: the platform's own API does not know them, they are never shown as pausable.
    const stores = allStores.filter((s) => s.locationCode === loc.code && !isRelayStore(s) && AVAILABILITY_CHANNELS.includes(s.channel));
    const holidays = holidaysFor(hours, loc.code, holidaysFrom, 10);
    const kitchenWeek = hours.locations[loc.code] ?? null;
    const kitchenOpening = nextOpening(kitchenWeek, holidays, now, tz);
    const allBrands = [...new Set(stores.map((s) => s.brandName))].sort((a, b) => a.localeCompare(b, 'fr'));
    const brands: BrandBoard[] = allBrands.filter((b) => !filter.brandNames?.length || filter.brandNames.includes(b)).map((name) => {
      const week = effectiveHours(hours, name, loc.code);
      const opening = nextOpening(week, holidays, now, tz);
      // A pause that ends while the brand is closed reopens for real at the next opening after it.
      const reopenAfter = (ms: number) => (week && !isOpenAt(week, holidays, ms, tz) ? nextOpening(week, holidays, ms, tz).nextOpenAt ?? ms : ms);
      const channels = stores.filter((s) => s.brandName === name)
        .sort((a, b) => AVAILABILITY_CHANNELS.indexOf(a.channel) - AVAILABILITY_CHANNELS.indexOf(b.channel))
        .map((s) => channelRow(s, opening, reopenAfter, now));
      if (isCloverWebsiteBrand(name, loc.code, allBrands)) {
        channels.push({ storeId: null, channel: 'clover_online', state: 'manuel', pausedUntil: null, by: null, reopensAt: null, locked: false,
          text: { fr: 'Mettez aussi en pause dans Clover', en: 'Also pause it in Clover' } });
      }
      return { name, nextOpening: opening, channels };
    });
    const prep = await prepFor(loc.code);
    const kitchenDevices = devices.filter((d) => d.locationCode === loc.code && !d.revoked);
    const lastSeen = kitchenDevices.map((d) => d.lastSeenAt).filter((x): x is string => Boolean(x)).sort().pop() ?? null;
    kitchens.push({
      code: loc.code, name: loc.name,
      prep: { normal: prep.normal, busy: prep.busy, isBusy: prep.isBusy, minutes: prep.minutes },
      devices: { online: kitchenDevices.filter((d) => deviceStatus(d, now) === 'online').length, total: kitchenDevices.length, lastSeenAt: lastSeen },
      nextOpening: kitchenOpening,
      summary: kitchenSummary(brands, kitchenOpening),
      brands,
    });
  }
  return { at: new Date(now).toISOString(), kitchens };
}
