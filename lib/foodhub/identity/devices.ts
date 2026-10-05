// Kitchen tablets (and wall screens). A manager enrols a browser once: it gets a long-lived signed device
// cookie, shows the PIN screen instead of the email sign-in, and sends a heartbeat every 30 s
// (sound on? screen visible? battery?). The Watchtower uses the heartbeat for "your tablet is off" alerts.
import crypto from 'node:crypto';
import { logActivity, type Actor } from '../activity';
import { getRepo } from '../repo';
import { DEVICE_COOKIE, DEVICE_DAYS, cookieFlags, readCookie, signDevice, verifyDevice } from '../session';

export const DEVICES = 'devices';
/** A device that has not checked in for this long is offline. */
export const DEVICE_OFFLINE_AFTER_MS = 90_000;

export interface Device {
  id: string;
  name: string;
  locationCode: string;
  enrolledBy: string;
  enrolledAt: string;
  lastSeenAt?: string | null;
  /** Last heartbeat details */
  soundOn?: boolean | null;
  visible?: boolean | null;
  battery?: number | null;
  charging?: boolean | null;
  screen?: string | null;
  userAgent?: string | null;
  /** Who is signed in on it right now (PIN session), if anyone */
  signedIn?: string | null;
  revoked?: boolean;
  revokedAt?: string | null;
}

export type DeviceStatus = 'online' | 'offline' | 'never' | 'revoked';

export function deviceStatus(d: Device, now = Date.now()): DeviceStatus {
  if (d.revoked) return 'revoked';
  if (!d.lastSeenAt) return 'never';
  return now - Date.parse(d.lastSeenAt) <= DEVICE_OFFLINE_AFTER_MS ? 'online' : 'offline';
}

export async function listDevices(): Promise<Device[]> {
  return (await getRepo().listDocs<Device>(DEVICES, { limit: 500 })).map((d) => d.data).sort((a, b) => (a.locationCode + a.name).localeCompare(b.locationCode + b.name));
}

export async function getDevice(id: string): Promise<Device | null> {
  return (await getRepo().getDoc<Device>(DEVICES, id))?.data ?? null;
}

async function save(d: Device) {
  await getRepo().putDocs<Device>(DEVICES, [{ id: d.id, key: d.locationCode, at: d.enrolledAt, data: d }]);
  return d;
}

/** Enrol this browser. Returns the device and the Set-Cookie header value. */
export async function enrollDevice(input: { name: string; locationCode: string }, actor: Actor): Promise<{ device: Device; cookie: string }> {
  const device: Device = {
    id: crypto.randomUUID(), name: input.name.trim().slice(0, 60) || 'Tablette cuisine', locationCode: input.locationCode,
    enrolledBy: actor.name, enrolledAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  };
  await save(device);
  const token = await signDevice({ d: device.id, l: device.locationCode, exp: Math.floor(Date.now() / 1000) + DEVICE_DAYS * 86400 });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'device_enrolled', status: 'success', locationCode: device.locationCode, summary: `Kitchen tablet "${device.name}" enrolled at ${device.locationCode}` });
  return { device, cookie: `${DEVICE_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(DEVICE_DAYS * 86400)}` };
}

export async function updateDevice(id: string, patch: Partial<Pick<Device, 'name' | 'locationCode'>>, actor: Actor): Promise<Device | null> {
  const d = await getDevice(id);
  if (!d) return null;
  const next = { ...d, ...(patch.name ? { name: patch.name.trim().slice(0, 60) } : {}), ...(patch.locationCode ? { locationCode: patch.locationCode } : {}) };
  await save(next);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'device_updated', status: 'success', locationCode: next.locationCode, summary: `Kitchen tablet "${next.name}" updated` });
  return next;
}

export async function revokeDevice(id: string, actor: Actor): Promise<boolean> {
  const d = await getDevice(id);
  if (!d) return false;
  await save({ ...d, revoked: true, revokedAt: new Date().toISOString(), signedIn: null });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'device_revoked', status: 'success', locationCode: d.locationCode, summary: `Kitchen tablet "${d.name}" removed — it must be enrolled again` });
  return true;
}

/** The enrolled, non-revoked device this request comes from (signed cookie), or null. */
export async function deviceFromRequest(req: Request): Promise<Device | null> {
  const p = await verifyDevice(readCookie(req.headers.get('cookie'), DEVICE_COOKIE));
  if (!p) return null;
  const d = await getDevice(p.d);
  return d && !d.revoked ? d : null;
}

export function forgetDeviceCookie(): string {
  return `${DEVICE_COOKIE}=; ${cookieFlags(0)}`;
}

export async function heartbeat(d: Device, info: { soundOn?: unknown; visible?: unknown; battery?: unknown; charging?: unknown; screen?: unknown; signedIn?: string | null }, userAgent?: string | null): Promise<Device> {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
  const bool = (v: unknown) => (typeof v === 'boolean' ? v : null);
  const next: Device = {
    ...d, lastSeenAt: new Date().toISOString(), soundOn: bool(info.soundOn), visible: bool(info.visible), battery: num(info.battery), charging: bool(info.charging),
    screen: typeof info.screen === 'string' ? info.screen.slice(0, 40) : d.screen ?? null, signedIn: info.signedIn ?? null, userAgent: userAgent?.slice(0, 160) ?? d.userAgent ?? null,
  };
  await save(next);
  return next;
}
