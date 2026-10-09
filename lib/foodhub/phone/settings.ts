// AI phone ordering — the phone lines and how the agent behaves.
// One Twilio number = one line = one kitchen (location) and the brands it sells on that number. Stored in fh_kv.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { normalizePhone } from '../notify';
import { getRepo } from '../repo';

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
}

export interface PhoneSettings {
  lines: PhoneLine[];
  voiceFr: string;
  voiceEn: string;
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
  lines: [], voiceFr: 'Polly.Gabrielle-Neural', voiceEn: 'Polly.Joanna-Neural', speechModel: 'googlev2_telephony', speechTimeout: 2, smsConfirmation: true, maxTurns: 40,
};

const VOICE = /^(Polly|Google)\.[A-Za-z0-9-]{3,60}$/;

export function cleanLine(raw: Partial<PhoneLine>): PhoneLine {
  const number = normalizePhone(raw.number);
  if (!number) throw new Error('Phone number: use the Twilio number in full, e.g. +15145550123.');
  if (!raw.locationCode || !/^[A-Z0-9_]{2,30}$/.test(raw.locationCode)) throw new Error('Choose the kitchen (location) for this line.');
  const brands = [...new Set((raw.brands ?? []).map((b) => String(b).trim()).filter(Boolean))].slice(0, 12);
  if (!brands.length) throw new Error('Choose at least one brand sold on this line.');
  const handoff = raw.handoffNumber ? normalizePhone(raw.handoffNumber) : null;
  if (raw.handoffNumber && !handoff) throw new Error('Hand-off number: not a phone number.');
  return {
    id: raw.id || `line_${crypto.randomBytes(4).toString('hex')}`,
    number,
    name: String(raw.name || brands[0]).trim().slice(0, 80),
    locationCode: raw.locationCode,
    brands,
    enabled: raw.enabled !== false,
    delivery: Boolean(raw.delivery),
    ...(handoff ? { handoffNumber: handoff } : {}),
  };
}

export async function getPhoneSettings(): Promise<PhoneSettings> {
  const raw = (await getRepo().getKv<Partial<PhoneSettings>>(KEY).catch(() => null)) ?? {};
  const s = { ...DEFAULT_PHONE, ...raw };
  return {
    lines: Array.isArray(s.lines) ? s.lines : [],
    voiceFr: VOICE.test(String(s.voiceFr)) ? s.voiceFr : DEFAULT_PHONE.voiceFr,
    voiceEn: VOICE.test(String(s.voiceEn)) ? s.voiceEn : DEFAULT_PHONE.voiceEn,
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
    summary: `Phone ordering: ${lines.length} line(s) — ${lines.filter((l) => l.enabled).map((l) => `${l.name} (${l.locationCode})`).join(', ') || 'none on'}` });
  return getPhoneSettings();
}

export async function lineForNumber(to: string | null | undefined): Promise<PhoneLine | null> {
  const n = normalizePhone(to);
  if (!n) return null;
  return (await getPhoneSettings()).lines.find((l) => l.number === n) ?? null;
}
