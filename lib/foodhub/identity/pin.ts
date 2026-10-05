// Staff PINs (4–6 digits). A PIN unlocks a kitchen tablet for its owner and lets a manager approve a
// gated action (reject, cancel, refund-like changes, store pause…) on anyone's screen.
// PINs are short, so the real protection is the lockout: 5 wrong PINs → 5 minutes locked, per device/IP.
import crypto from 'node:crypto';
import { getRepo } from '../repo';
import type { FoodHubUser, Role } from '../types';

const N = 4096; // PINs are low-entropy anyway; a lighter scrypt keeps "find the approver" fast.

export function pinProblem(pin: string): string | null {
  if (!/^\d{4,6}$/.test(pin)) return 'Le NIP doit avoir 4 à 6 chiffres. / PIN must be 4–6 digits.';
  if (/^(\d)\1+$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) return 'NIP trop simple (1111, 1234…). / PIN too easy to guess.';
  return null;
}

export function hashPin(pin: string): string {
  const salt = crypto.randomBytes(12);
  const hash = crypto.scryptSync(pin, salt, 24, { N, r: 8, p: 1 });
  return `pin1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPin(pin: string, stored: string | null | undefined): boolean {
  if (!stored || !/^\d{4,6}$/.test(pin)) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'pin1' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pin, Buffer.from(salt, 'base64'), expected.length, { N, r: 8, p: 1 });
  return crypto.timingSafeEqual(expected, got);
}

// ---------- lockout (per device or IP) ----------

type Strikes = Map<string, { count: number; until: number }>;
function strikes(): Strikes {
  const g = globalThis as unknown as { __takatakPinStrikes?: Strikes };
  if (!g.__takatakPinStrikes) g.__takatakPinStrikes = new Map();
  return g.__takatakPinStrikes;
}

export function lockedFor(who: string): number {
  const s = strikes().get(who);
  return s && s.count >= 5 && s.until > Date.now() ? Math.ceil((s.until - Date.now()) / 1000) : 0;
}
export function noteFailure(who: string) {
  const s = strikes().get(who);
  const fresh = !s || s.until < Date.now();
  strikes().set(who, { count: (fresh ? 0 : s!.count) + 1, until: Date.now() + 5 * 60_000 });
}
export function noteSuccess(who: string) { strikes().delete(who); }

export function clientKey(req: Request, deviceId?: string | null): string {
  if (deviceId) return `dev:${deviceId}`;
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'local';
  return `ip:${ip}`;
}

/** The active person whose PIN this is, among the given roles and (when given) people allowed at that location. */
export async function findApprover(pin: string, roles: Role[], locationCode?: string | null): Promise<FoodHubUser | null> {
  if (!/^\d{4,6}$/.test(pin)) return null;
  const users = (await getRepo().listUsers()).filter((u) => u.active && u.pinHash && roles.includes(u.role) && (!locationCode || !u.locations?.length || u.locations.includes(locationCode)));
  for (const u of users) if (checkPin(pin, u.pinHash)) return u;
  return null;
}

/** Two managers must not share a PIN (an approval has to name one person). */
export async function pinTakenByOther(pin: string, username: string): Promise<boolean> {
  const users = (await getRepo().listUsers()).filter((u) => u.active && u.pinHash && u.username !== username);
  return users.some((u) => checkPin(pin, u.pinHash));
}
