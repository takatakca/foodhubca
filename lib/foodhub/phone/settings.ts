// AI phone ordering — the phone lines and how the agent behaves.
// One Twilio number = one line. A line sells brands from one kitchen (location), or from several kitchens
// ("brand@kitchen" groups: Po Poulet at NDG and at Saint-Léonard on the same number). On a line with several kitchens the
// agent first asks which restaurant the caller wants (tool choose_kitchen); everything after that — menu, hours, delivery
// area, hand-off phone, the Clover ticket — is that kitchen's. Stored in fh_kv.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { normalizePhone } from '../notify';
import { getRepo } from '../repo';

/** One kitchen served by a line, with the brands sold from it on that number. */
export interface PhoneLineKitchen {
  locationCode: string;
  brands: string[];
}

export interface PhoneLine {
  id: string;
  /** The Twilio number customers call (E.164). */
  number: string;
  /** Spoken name: "Po Poulet, Notre-Dame-de-Grâce". */
  name: string;
  locationCode: string;
  /** Brands whose menus the agent sells on this line (the first one is the main brand). */
  brands: string[];
  enabled: boolean;
  /** Delivery by phone needs the own-delivery feature and a delivery rule for the location. */
  delivery: boolean;
  /** Who takes over when the caller asks for a person (default: the kitchen phone from Settings → Business). */
  handoffNumber?: string;
  /**
   * Several kitchens on this number (two or more brand@kitchen groups). When set, `locationCode` is the first kitchen and
   * `brands` every brand of the line; the agent asks which kitchen before taking items. Absent = one kitchen.
   */
  kitchens?: PhoneLineKitchen[];
}

export interface PhoneSettings {
  lines: PhoneLine[];
  voiceFr: string;
  voiceEn: string;
  /** Spanish voice (es-US), for callers who chose español on the ON2GO menu. */
  voiceEs: string;
  /** Twilio speech model (fr-CA is supported by phone_call and googlev2_telephony; English uses en-US). */
  speechModel: string;
  /** Seconds of silence that end the caller's sentence (Twilio needs a whole number with a speech model). */
  speechTimeout: number;
  /** Text the customer a confirmation with the order number and total. */
  smsConfirmation: boolean;
  /** Turns before the agent hands the call to a person (a call that goes in circles). */
  maxTurns: number;
  updatedAt?: string;
}

const KEY = 'phone_settings_v1';

export const DEFAULT_PHONE: PhoneSettings = {
  lines: [], voiceFr: 'Polly.Gabrielle-Neural', voiceEn: 'Polly.Joanna-Neural', voiceEs: 'Polly.Lupe-Neural', speechModel: 'googlev2_telephony', speechTimeout: 2, smsConfirmation: true, maxTurns: 40,
};

const VOICE = /^(Polly|Google)\.[A-Za-z0-9-]{3,60}$/;

const CODE = /^[A-Z0-9_]{2,30}$/;
const MAX_BRANDS = 30;
const brandList = (raw: unknown): string[] => [...new Set((Array.isArray(raw) ? raw : []).map((b) => String(b).trim()).filter(Boolean))].slice(0, MAX_BRANDS);

/** Every kitchen a line serves, with its brands. A one-kitchen line gives one entry: its location and brands. */
export function lineKitchens(line: Pick<PhoneLine, 'locationCode' | 'brands' | 'kitchens'>): PhoneLineKitchen[] {
  return line.kitchens && line.kitchens.length ? line.kitchens : [{ locationCode: line.locationCode, brands: line.brands }];
}

/** True when the agent must ask the caller which kitchen (restaurant) before taking items. */
export function isMultiKitchen(line: Pick<PhoneLine, 'locationCode' | 'brands' | 'kitchens'>): boolean {
  return lineKitchens(line).length > 1;
}

/**
 * The line as seen from one of its kitchens: that kitchen's location and brands, no other kitchen. This is what the menu,
 * the opening hours, the delivery area, the hand-off phone and the order use. Null when the line does not serve it.
 */
export function kitchenView(line: PhoneLine, locationCode: string): PhoneLine | null {
  const k = lineKitchens(line).find((x) => x.locationCode === locationCode);
  if (!k) return null;
  const view: PhoneLine = { ...line, locationCode: k.locationCode, brands: k.brands };
  delete view.kitchens;
  return view;
}

export function cleanLine(raw: Partial<PhoneLine>): PhoneLine {
  const number = normalizePhone(raw.number);
  if (!number) throw new Error('Phone number: use the Twilio number in full, e.g. +15145550123.');
  const handoff = raw.handoffNumber ? normalizePhone(raw.handoffNumber) : null;
  if (raw.handoffNumber && !handoff) throw new Error('Hand-off number: not a phone number.');
  // Kitchens: brand@kitchen groups. No group = the classic one-kitchen line (locationCode + brands).
  const groups: PhoneLineKitchen[] = [];
  for (const k of Array.isArray(raw.kitchens) ? raw.kitchens : []) {
    const code = String(k?.locationCode ?? '');
    if (!CODE.test(code)) throw new Error('Choose the kitchen (location) for each kitchen of this line.');
    if (groups.some((g) => g.locationCode === code)) throw new Error(`Kitchen ${code} is listed twice on this line.`);
    const brands = brandList(k?.brands);
    if (!brands.length) throw new Error(`Choose at least one brand sold from ${code} on this line.`);
    groups.push({ locationCode: code, brands });
  }
  if (!groups.length) {
    if (!raw.locationCode || !CODE.test(raw.locationCode)) throw new Error('Choose the kitchen (location) for this line.');
    const brands = brandList(raw.brands);
    if (!brands.length) throw new Error('Choose at least one brand sold on this line.');
    groups.push({ locationCode: raw.locationCode, brands });
  }
  const all = [...new Set(groups.flatMap((g) => g.brands))];
  return {
    id: raw.id || `line_${crypto.randomBytes(4).toString('hex')}`,
    number,
    name: String(raw.name || all[0]).trim().slice(0, 80),
    locationCode: groups[0].locationCode,
    brands: groups.length > 1 ? all : groups[0].brands,
    enabled: raw.enabled !== false,
    delivery: Boolean(raw.delivery),
    ...(handoff ? { handoffNumber: handoff } : {}),
    ...(groups.length > 1 ? { kitchens: groups } : {}),
  };
}

export async function getPhoneSettings(): Promise<PhoneSettings> {
  const raw = (await getRepo().getKv<Partial<PhoneSettings>>(KEY).catch(() => null)) ?? {};
  const s = { ...DEFAULT_PHONE, ...raw };
  return {
    lines: Array.isArray(s.lines) ? s.lines : [],
    voiceFr: VOICE.test(String(s.voiceFr)) ? s.voiceFr : DEFAULT_PHONE.voiceFr,
    voiceEn: VOICE.test(String(s.voiceEn)) ? s.voiceEn : DEFAULT_PHONE.voiceEn,
    voiceEs: VOICE.test(String(s.voiceEs)) ? s.voiceEs : DEFAULT_PHONE.voiceEs,
    speechModel: /^[a-z0-9_.-]{3,40}$/i.test(String(s.speechModel)) ? s.speechModel : DEFAULT_PHONE.speechModel,
    speechTimeout: Math.min(5, Math.max(1, Math.round(Number(s.speechTimeout) || DEFAULT_PHONE.speechTimeout))),
    smsConfirmation: s.smsConfirmation !== false,
    maxTurns: Math.min(80, Math.max(10, Math.round(Number(s.maxTurns) || DEFAULT_PHONE.maxTurns))),
    updatedAt: s.updatedAt,
  };
}

export async function savePhoneSettings(patch: Partial<PhoneSettings>, actor: Actor): Promise<PhoneSettings> {
  const cur = await getPhoneSettings();
  const lines = patch.lines ? patch.lines.map(cleanLine) : cur.lines;
  const dup = lines.find((l, i) => lines.findIndex((x) => x.number === l.number) !== i);
  if (dup) throw new Error(`${dup.number} is used by two lines.`);
  const next: PhoneSettings = { ...cur, ...patch, lines, updatedAt: new Date().toISOString() };
  await getRepo().setKv(KEY, next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'settings', action: 'phone_settings', status: 'success',
    summary: `Phone ordering: ${lines.length} line(s) — ${lines.filter((l) => l.enabled).map((l) => `${l.name} (${lineKitchens(l).map((k) => k.locationCode).join(' + ')})`).join(', ') || 'none on'}` });
  return getPhoneSettings();
}

export async function lineForNumber(to: string | null | undefined): Promise<PhoneLine | null> {
  const n = normalizePhone(to);
  if (!n) return null;
  return (await getPhoneSettings()).lines.find((l) => l.number === n) ?? null;
}
