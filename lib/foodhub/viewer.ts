// Who is looking at a page (server components). Same rules as getActor() for API routes.
import { cookies, headers } from 'next/headers';
import { getCatalog } from './catalog';
import { getDevice } from './identity/devices';
import { getRepo } from './repo';
import { ownerSeedStores } from './owner-seed';
import { buildScopeCatalog, channelsOf, type StorePoint } from './scope';
import { basicOwner, ownerSessionVersion, readCookie, ROLE_PERMISSIONS, SESSION_COOKIE, userSessionVersion, verifySession, type Permission } from './session';
import type { Role } from './types';

export interface Viewer {
  username: string;
  name: string;
  role: Role;
  locations: string[];
  permissions: Permission[];
  builtin: boolean;
  hasPin: boolean;
  email: string | null;
  phone: string | null;
  device: { id: string; name: string; locationCode: string } | null;
  lang: 'fr' | 'en' | null;
}

export async function getViewer(): Promise<Viewer | null> {
  const h = await headers();
  const jar = await cookies();
  const owner = (name = 'Owner'): Viewer => ({ username: 'owner', name, role: 'owner', locations: [], permissions: ROLE_PERMISSIONS.owner, builtin: true, hasPin: false, email: null, phone: null, device: null, lang: null });
  if (basicOwner(h.get('authorization'))) return owner();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value ?? readCookie(h.get('cookie')));
  if (!session?.v) return null; // same rules as getActor(): a cookie is only valid while its session version matches
  if (session.b) return session.v === ownerSessionVersion() ? owner(session.n || 'Owner') : null;
  const user = await getRepo().getUser(session.u).catch(() => null);
  if (!user?.active || session.v !== userSessionVersion(user)) return null;
  const device = session.d ? await getDevice(session.d).catch(() => null) : null;
  if (session.d && (!device || device.revoked)) return null;
  return {
    username: user.username, name: user.name, role: user.role, locations: user.locations ?? [], permissions: ROLE_PERMISSIONS[user.role],
    builtin: false, hasPin: Boolean(user.pinHash), email: user.email ?? null, phone: user.phone ?? null,
    device: device ? { id: device.id, name: device.name, locationCode: device.locationCode } : null, lang: user.prefs?.lang ?? null,
  };
}

/**
 * What the console may show this person: their kitchens, the active brands, which brands each kitchen sells (platform
 * stores mapped in Food Hub + the owner's DoorDash list on the owner's own instance), the platforms they have stores on,
 * and one point per store for the counts ("DoorDash (15)"). No store or merchant id leaves the server here.
 */
export async function viewerCatalog(v: Viewer) {
  const c = await getCatalog();
  const locations = c.locations.filter((l) => l.active && (!v.locations.length || v.locations.includes(l.code))).map((l) => ({ code: l.code, name: l.name, address: l.address }));
  const brands = c.brands.filter((b) => b.active).map((b) => b.name);
  const stores = await getRepo().listStores().catch(() => []);
  const seed = ownerSeedStores();
  const pairs = [
    ...stores.filter((s) => s.channel !== 'tgtg').map((s) => ({ brandName: s.brandName, locationCode: s.locationCode })),
    ...seed.map((s) => ({ brandName: s.brand_name, locationCode: s.location_code })),
  ];
  const { brandsByKitchen } = buildScopeCatalog(locations.map((l) => l.code), pairs, brands);
  // Store counts: the mapped platform stores of the person's locations (Too Good To Go included), plus — on the owner's
  // instance — the DoorDash stores of his list that are not mapped yet.
  const visible = new Set(locations.map((l) => l.code));
  const known = new Set(brands);
  const points: StorePoint[] = stores
    .filter((s) => visible.has(s.locationCode) && known.has(s.brandName))
    .map((s) => ({ brandName: s.brandName, locationCode: s.locationCode, channel: s.channel }));
  const ddMapped = new Set(points.filter((p) => p.channel === 'doordash').map((p) => `${p.brandName}|${p.locationCode}`));
  for (const s of seed) {
    if (!visible.has(s.location_code) || !known.has(s.brand_name) || ddMapped.has(`${s.brand_name}|${s.location_code}`)) continue;
    points.push({ brandName: s.brand_name, locationCode: s.location_code, channel: 'doordash' });
  }
  return { locations, brands, brandsByKitchen, channels: channelsOf(points), stores: points };
}
