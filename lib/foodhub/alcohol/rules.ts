// Alcohol: who may sell it, where, when, and what the courier must check.
//
// Québec (RACJ, checked 2026-10): alcohol sold for take-out / delivery needs a permit held by the location.
//   - Restaurant permit: 8:00–23:00, only WITH food prepared by the permit holder; delivery by a third party (DoorDash,
//     Uber…) is allowed only under a written agreement with that company, kept 3 years after it ends.
//   - Grocery permit (permis d'épicerie): 7:00–23:00, and the holder must deliver ITSELF — never through a third party.
//   - Never to anyone under 18 or visibly intoxicated: the courier checks photo ID at the door. Food Hub never decides that a location may sell alcohol: the owner enters the permit, ticks
// that they checked it, and opens each channel one by one. Everything starts CLOSED and nothing is ever turned on
// automatically. Expired permit → closed again, by itself.
//
// Where the rules apply (only while the "alcohol" feature switch is on; with it off nothing changes for platform menus,
// and the phone agent / own delivery never sell alcohol at all):
//   - menu publish: items tagged "alcohol" are left out of the menu sent to a store whose location/channel is not allowed
//   - AI phone agent: alcohol is not offered, and refused, unless the "phone" channel is allowed and it is legal hours
//   - own delivery: an order with alcohol is not dispatched unless "own_delivery" is allowed; the courier gets the
//     "alcohol / ID check 18+" flags (DoorDash Drive, Uber Direct)
//   - retail catalogue: alcohol products are left out of DoorDash / Uber Eats catalogue payloads unless allowed
import { logActivity, type Actor } from '../activity';
import { featureOn } from '../expansion/features';
import { getRepo } from '../repo';
import { foodhubTimeZone, localParts } from '../time';
import type { MasterMenu } from '../types';

/** Every place alcohol could be sold through Food Hub. */
export const ALCOHOL_CHANNELS = ['uber_eats', 'doordash', 'skip', 'tgtg', 'phone', 'website', 'own_delivery'] as const;
export type AlcoholChannel = (typeof ALCOHOL_CHANNELS)[number];
/** Channels where someone else's courier carries the alcohol (a "third party" for the RACJ). */
export const THIRD_PARTY_CHANNELS: AlcoholChannel[] = ['uber_eats', 'doordash', 'skip', 'tgtg', 'own_delivery'];

export const ALCOHOL_CHANNEL_LABELS: Record<AlcoholChannel, { fr: string; en: string }> = {
  uber_eats: { fr: 'Uber Eats', en: 'Uber Eats' },
  doordash: { fr: 'DoorDash', en: 'DoorDash' },
  skip: { fr: 'SkipTheDishes', en: 'SkipTheDishes' },
  tgtg: { fr: 'Too Good To Go', en: 'Too Good To Go' },
  phone: { fr: 'Téléphone (agent IA)', en: 'Phone (AI agent)' },
  website: { fr: 'Site web', en: 'Website' },
  own_delivery: { fr: 'Nos livraisons (DoorDash Drive / Uber Direct)', en: 'Own delivery (DoorDash Drive / Uber Direct)' },
};

export type PermitType = 'none' | 'restaurant' | 'epicerie' | 'bar' | 'other';

export interface LocationAlcohol {
  permitType: PermitType;
  permitNumber?: string;
  holderName?: string;
  /** YYYY-MM-DD. After this date the location is closed to alcohol again. */
  expiresOn?: string;
  /** The owner ticked "I checked this permit" — who and when. Required before anything opens. */
  verifiedBy?: string;
  verifiedAt?: string;
  /** Channels opened one by one by the owner. Missing = closed. */
  channels: Partial<Record<AlcoholChannel, boolean>>;
  /** Legal sale window for delivery / take-out, local time "HH:MM". */
  saleFrom: string;
  saleTo: string;
  /** Restaurant permits: alcohol only with a meal (an order of alcohol alone is refused). */
  requireFood: boolean;
  /** Restaurant permit: the written delivery agreement with the courier company is signed (RACJ) — needed for third-party channels. */
  thirdPartyAgreement: boolean;
}

export interface AlcoholSettings {
  locations: Record<string, LocationAlcohol>;
  minAge: number;
  updatedAt?: string;
}

const KEY = 'alcohol_settings_v1';

/** Legal take-out / delivery window per permit (RACJ) — the owner can narrow it, never widen it. */
export const PERMIT_HOURS: Record<PermitType, { from: string; to: string }> = {
  none: { from: '08:00', to: '23:00' }, restaurant: { from: '08:00', to: '23:00' }, epicerie: { from: '07:00', to: '23:00' },
  bar: { from: '08:00', to: '23:00' }, other: { from: '08:00', to: '23:00' },
};
export const DEFAULT_LOCATION_ALCOHOL: LocationAlcohol = { permitType: 'none', channels: {}, saleFrom: '08:00', saleTo: '23:00', requireFood: true, thirdPartyAgreement: false };
export const DEFAULT_ALCOHOL: AlcoholSettings = { locations: {}, minAge: 18 };

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function cleanLocationAlcohol(raw: Partial<LocationAlcohol> | undefined): LocationAlcohol {
  const r = { ...DEFAULT_LOCATION_ALCOHOL, ...(raw ?? {}) };
  const channels: Partial<Record<AlcoholChannel, boolean>> = {};
  for (const ch of ALCOHOL_CHANNELS) if (r.channels?.[ch] === true) channels[ch] = true;
  const permitType: PermitType = (['none', 'restaurant', 'epicerie', 'bar', 'other'] as PermitType[]).includes(r.permitType) ? r.permitType : 'none';
  const legal = PERMIT_HOURS[permitType];
  // The window can be narrowed, never opened earlier or later than the permit allows.
  // (Read from `raw`, not the merged defaults: no window given = the permit's own window.)
  const from = HHMM.test(String(raw?.saleFrom)) && String(raw?.saleFrom) >= legal.from ? String(raw?.saleFrom) : legal.from;
  const to = HHMM.test(String(raw?.saleTo)) && String(raw?.saleTo) <= legal.to && String(raw?.saleTo) > from ? String(raw?.saleTo) : legal.to;
  return {
    permitType,
    permitNumber: r.permitNumber ? String(r.permitNumber).trim().slice(0, 40) : undefined,
    holderName: r.holderName ? String(r.holderName).trim().slice(0, 120) : undefined,
    expiresOn: r.expiresOn && /^\d{4}-\d{2}-\d{2}$/.test(String(r.expiresOn)) ? String(r.expiresOn) : undefined,
    verifiedBy: r.verifiedBy ? String(r.verifiedBy).slice(0, 80) : undefined,
    verifiedAt: r.verifiedAt ? String(r.verifiedAt) : undefined,
    channels,
    saleFrom: from,
    saleTo: to,
    // A restaurant permit always requires food with the alcohol.
    requireFood: permitType === 'restaurant' ? true : r.requireFood !== false,
    thirdPartyAgreement: permitType === 'restaurant' && r.thirdPartyAgreement === true,
  };
}

export async function getAlcoholSettings(): Promise<AlcoholSettings> {
  const raw = (await getRepo().getKv<AlcoholSettings>(KEY).catch(() => null)) ?? DEFAULT_ALCOHOL;
  const locations: Record<string, LocationAlcohol> = {};
  for (const [code, l] of Object.entries(raw.locations ?? {})) locations[code] = cleanLocationAlcohol(l);
  const minAge = Number(raw.minAge);
  return { locations, minAge: Number.isFinite(minAge) && minAge >= 18 && minAge <= 25 ? Math.round(minAge) : 18, updatedAt: raw.updatedAt };
}

/**
 * Saves one location's permit and channels. Opening a channel needs a permit number, a permit type and the owner's
 * "I checked it" — otherwise the channels are saved closed and the reason is returned.
 */
export async function saveLocationAlcohol(locationCode: string, patch: Partial<LocationAlcohol> & { verify?: boolean }, actor: Actor): Promise<{ settings: AlcoholSettings; warning?: string }> {
  if (!/^[A-Z0-9_]{2,30}$/.test(locationCode)) throw new Error('Unknown location.');
  const cur = await getAlcoholSettings();
  const prev = cur.locations[locationCode] ?? { ...DEFAULT_LOCATION_ALCOHOL };
  const next = cleanLocationAlcohol({ ...prev, ...patch, channels: { ...prev.channels, ...(patch.channels ?? {}) } });
  // Changing the permit itself invalidates the previous check.
  if (patch.permitNumber !== undefined && (patch.permitNumber.trim() || undefined) !== prev.permitNumber) { next.verifiedBy = undefined; next.verifiedAt = undefined; }
  if (patch.permitType !== undefined && patch.permitType !== prev.permitType) { next.verifiedBy = undefined; next.verifiedAt = undefined; }
  if (patch.verify) { next.verifiedBy = actor.name; next.verifiedAt = new Date().toISOString(); }
  let warning: string | undefined;
  const opened = Object.values(next.channels).some(Boolean);
  if (opened && (next.permitType === 'none' || !next.permitNumber || !next.verifiedAt)) {
    next.channels = {};
    warning = 'Channels stay closed until a permit type, a permit number and "I checked this permit" are set.';
  }
  const settings: AlcoholSettings = { ...cur, locations: { ...cur.locations, [locationCode]: next }, updatedAt: new Date().toISOString() };
  await getRepo().setKv(KEY, settings);
  const open = Object.entries(next.channels).filter(([, v]) => v).map(([k]) => k);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'alcohol_rules', status: warning ? 'info' : 'success', locationCode,
    summary: `Alcohol at ${locationCode}: permit ${next.permitType}${next.permitNumber ? ` #${next.permitNumber}` : ''}${next.verifiedAt ? ' (checked)' : ''} — open on ${open.length ? open.join(', ') : 'no channel'}${warning ? ` — ${warning}` : ''}` });
  return { settings, warning };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Inside the sale window (handles a window that crosses midnight). */
export function withinSaleHours(rule: Pick<LocationAlcohol, 'saleFrom' | 'saleTo'>, now = Date.now(), timeZone = foodhubTimeZone()): boolean {
  const p = localParts(now, timeZone);
  const m = p.hour * 60 + p.minute;
  const from = minutesOf(rule.saleFrom);
  const to = minutesOf(rule.saleTo);
  if (from === to) return false;
  return from < to ? m >= from && m < to : m >= from || m < to;
}

export function permitExpired(rule: Pick<LocationAlcohol, 'expiresOn'>, now = Date.now(), timeZone = foodhubTimeZone()): boolean {
  if (!rule.expiresOn) return false;
  const p = localParts(now, timeZone);
  const today = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return today > rule.expiresOn;
}

export interface AlcoholDecision { allowed: boolean; reason: string; reasonFr: string; requireFood?: boolean; minAge: number }

/** May this location sell alcohol on this channel right now? (`ignoreHours` = may it be listed at all, e.g. on a menu.) */
export function alcoholDecision(settings: AlcoholSettings, featureEnabled: boolean, locationCode: string | null | undefined, channel: AlcoholChannel, opts: { now?: number; ignoreHours?: boolean } = {}): AlcoholDecision {
  const minAge = settings.minAge;
  const no = (reason: string, reasonFr: string): AlcoholDecision => ({ allowed: false, reason, reasonFr, minAge });
  if (!featureEnabled) return no('Alcohol is turned off (Settings → Expansion).', 'L’alcool est désactivé (Réglages → Expansion).');
  const rule = locationCode ? settings.locations[locationCode] : undefined;
  if (!rule || rule.permitType === 'none' || !rule.permitNumber) return no(`No RACJ permit entered for ${locationCode ?? 'this location'}.`, `Aucun permis RACJ inscrit pour ${locationCode ?? 'cette succursale'}.`);
  if (!rule.verifiedAt) return no('The permit has not been checked by the owner yet.', 'Le permis n’a pas encore été vérifié par le propriétaire.');
  if (permitExpired(rule, opts.now)) return no(`The permit expired on ${rule.expiresOn}.`, `Le permis est expiré depuis le ${rule.expiresOn}.`);
  if (THIRD_PARTY_CHANNELS.includes(channel)) {
    if (rule.permitType === 'epicerie') return no('A grocery permit (permis d’épicerie) does not allow delivery by a third party — alcohol is pickup only.', 'Un permis d’épicerie ne permet pas la livraison par un tiers — l’alcool est pour emporter seulement.');
    if (rule.permitType === 'restaurant' && !rule.thirdPartyAgreement) return no('Alcohol delivered by a third party needs the written agreement with the delivery company (RACJ) — tick it once it is signed.', 'La livraison d’alcool par un tiers exige l’entente écrite avec l’entreprise de livraison (RACJ) — cochez-la une fois signée.');
  }
  if (!rule.channels[channel]) return no(`Alcohol is not opened on ${ALCOHOL_CHANNEL_LABELS[channel].en} for this location.`, `L’alcool n’est pas ouvert sur ${ALCOHOL_CHANNEL_LABELS[channel].fr} pour cette succursale.`);
  if (!opts.ignoreHours && !withinSaleHours(rule, opts.now)) return no(`Outside the legal sale hours (${rule.saleFrom}–${rule.saleTo}).`, `Hors des heures légales de vente (${rule.saleFrom}–${rule.saleTo}).`);
  return { allowed: true, reason: 'Allowed', reasonFr: 'Permis', requireFood: rule.requireFood, minAge };
}

export async function decideAlcohol(locationCode: string | null | undefined, channel: AlcoholChannel, opts: { now?: number; ignoreHours?: boolean } = {}): Promise<AlcoholDecision> {
  const [settings, on] = await Promise.all([getAlcoholSettings(), featureOn('alcohol')]);
  return alcoholDecision(settings, on, locationCode, channel, opts);
}

export const isAlcoholItem = (i: { tags?: string[] }) => (i.tags ?? []).includes('alcohol');

/**
 * The menu a platform store may receive. With the alcohol feature off this is the menu unchanged (today's behaviour);
 * with it on, alcohol items are left out wherever the location / channel is not allowed.
 * Listing does not depend on the hour: platforms apply their own alcohol hours once approved.
 */
export async function menuWithAlcoholRules(menu: MasterMenu, locationCode: string, channel: AlcoholChannel): Promise<MasterMenu> {
  if (!menu.items.some(isAlcoholItem)) return menu;
  if (!(await featureOn('alcohol'))) return menu;
  const d = await decideAlcohol(locationCode, channel, { ignoreHours: true });
  if (d.allowed) return menu;
  const items = menu.items.filter((i) => !isAlcoholItem(i));
  return { ...menu, items };
}
