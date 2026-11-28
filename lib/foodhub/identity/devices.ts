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
  /** Provenance of the most recent signed heartbeat, separate from enrollment. */
  lastHeartbeat?: { at: string; locationCode: string };
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

type StoredDevice = Device & { revision?: string };
type DeviceBinding = Pick<Device, 'locationCode' | 'enrolledAt'>;

export class DeviceHeartbeatConflict extends Error {
  constructor(readonly reason: 'revoked' | 'moved' | 'busy') { super(reason); }
}

export type DeviceStatus = 'online' | 'offline' | 'never' | 'revoked';

export function deviceStatus(d: Device, now = Date.now()): DeviceStatus {
  if (d.revoked) return 'revoked';
  if (!d.lastSeenAt) return 'never';
  return now - Date.parse(d.lastSeenAt) <= DEVICE_OFFLINE_AFTER_MS ? 'online' : 'offline';
}

export async function listDevices(): Promise<Device[]> {
  return (await getRepo().listDocs<StoredDevice>(DEVICES, { limit: 500 })).map((d) => publicDevice(d.data)).sort((a, b) => (a.locationCode + a.name).localeCompare(b.locationCode + b.name));
}

export async function getDevice(id: string): Promise<Device | null> {
  const stored = await getRepo().getDoc<StoredDevice>(DEVICES, id);
  return stored ? publicDevice(stored.data) : null;
}

function publicDevice({ revision: _revision, ...device }: StoredDevice): Device {
  return device;
}

function deviceDoc(device: Device) {
  return { id: device.id, key: device.locationCode, at: device.enrolledAt, data: { ...device, revision: crypto.randomUUID() } };
}

function sameBinding(device: Device, expected: DeviceBinding) {
  return device.locationCode === expected.locationCode && device.enrolledAt === expected.enrolledAt;
}

async function changeDevice(id: string, change: (device: Device | null) => Device | null): Promise<Device | null> {
  const repo = getRepo();
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await repo.getDoc<StoredDevice>(DEVICES, id);
    const next = change(current ? publicDevice(current.data) : null);
    if (!current || !next) return null;
    if (await repo.replaceDocIfRevision(DEVICES, deviceDoc(next), current.data.revision)) return next;
  }
  return null;
}

/** Enrol this browser. Returns the device and the Set-Cookie header value. */
export async function enrollDevice(input: { name: string; locationCode: string }, actor: Actor): Promise<{ device: Device; cookie: string }> {
  const device: Device = {
    id: crypto.randomUUID(), name: input.name.trim().slice(0, 60) || 'Tablette cuisine', locationCode: input.locationCode,
    enrolledBy: actor.name, enrolledAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(),
  };
  await getRepo().putDocs(DEVICES, [deviceDoc(device)]);
  const token = await signDevice({ d: device.id, l: device.locationCode, exp: Math.floor(Date.now() / 1000) + DEVICE_DAYS * 86400 });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'device_enrolled', status: 'success', locationCode: device.locationCode, summary: `Kitchen tablet "${device.name}" enrolled at ${device.locationCode}` });
  return { device, cookie: `${DEVICE_COOKIE}=${encodeURIComponent(token)}; ${cookieFlags(DEVICE_DAYS * 86400)}` };
}

export async function updateDevice(id: string, patch: Partial<Pick<Device, 'name' | 'locationCode'>>, actor: Actor, expected?: DeviceBinding): Promise<Device | null> {
  const next = await changeDevice(id, (d) => d && (!expected || sameBinding(d, expected))
    ? { ...d, ...(patch.name ? { name: patch.name.trim().slice(0, 60) } : {}), ...(patch.locationCode ? { locationCode: patch.locationCode } : {}) }
    : null);
  if (!next) return null;
  await logActivity({ actor: actor.name, source: actor.source, kind: 'device', action: 'device_updated', status: 'success', locationCode: next.locationCode, summary: `Kitchen tablet "${next.name}" updated` });
  return next;
}

export async function revokeDevice(id: string, actor: Actor, expected?: DeviceBinding): Promise<boolean> {
  const d = await changeDevice(id, (current) => current && (!expected || sameBinding(current, expected))
    ? { ...current, revoked: true, revokedAt: new Date().toISOString(), signedIn: null }
    : null);
  if (!d) return false;
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
  const next = await changeDevice(d.id, (current) => {
    if (!current || current.revoked) throw new DeviceHeartbeatConflict('revoked');
    if (!sameBinding(current, d)) throw new DeviceHeartbeatConflict('moved');
    const at = new Date().toISOString();
    return {
      ...current, lastSeenAt: at, lastHeartbeat: { at, locationCode: current.locationCode },
      soundOn: bool(info.soundOn), visible: bool(info.visible), battery: num(info.battery), charging: bool(info.charging),
      screen: typeof info.screen === 'string' ? info.screen.slice(0, 40) : current.screen ?? null, signedIn: info.signedIn ?? null, userAgent: userAgent?.slice(0, 160) ?? current.userAgent ?? null,
    };
  });
  if (!next) throw new DeviceHeartbeatConflict('busy');
  return next;
}
