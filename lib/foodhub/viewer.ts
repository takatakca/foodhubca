// Who is looking at a page (server components). Same rules as getActor() for API routes.
import { cookies, headers } from 'next/headers';
import { getCatalog } from './catalog';
import { getDevice } from './identity/devices';
import { getRepo } from './repo';
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

export async function viewerCatalog(v: Viewer) {
  const c = await getCatalog();
  return {
    locations: c.locations.filter((l) => l.active && (!v.locations.length || v.locations.includes(l.code))).map((l) => ({ code: l.code, name: l.name, address: l.address })),
    brands: c.brands.filter((b) => b.active).map((b) => b.name),
  };
}
