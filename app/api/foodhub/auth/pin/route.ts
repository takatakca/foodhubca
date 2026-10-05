import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { sessionCookieFor } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { deviceFromRequest } from '@/lib/foodhub/identity/devices';
import { checkPin, clientKey, lockedFor, noteFailure, noteSuccess } from '@/lib/foodhub/identity/pin';
import { getRepo } from '@/lib/foodhub/repo';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Kitchen tablet PIN screen. Only works on an enrolled device (signed device cookie).
// GET  → the tablet and the people who can unlock it (name + role, never contact details)
// POST { username, pin } → a 14-hour session for that person on this tablet
export async function GET(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return fail('Cet appareil n’est pas une tablette enregistrée. / This device is not an enrolled tablet.', 403);
  const people = (await getRepo().listUsers())
    .filter((u) => u.active && u.pinHash && can(u.role, 'view') && (!u.locations?.length || u.locations.includes(device.locationCode)))
    .map((u) => ({ username: u.username, name: u.name, role: u.role }));
  return ok({ device: { id: device.id, name: device.name, locationCode: device.locationCode }, people, locked: lockedFor(clientKey(req, device.id)) });
}

export async function POST(req: Request) {
  const device = await deviceFromRequest(req);
  if (!device) return fail('Cet appareil n’est pas une tablette enregistrée. / This device is not an enrolled tablet.', 403);
  const who = clientKey(req, device.id);
  const wait = lockedFor(who);
  if (wait) return fail(`Trop d’essais. Réessayez dans ${Math.ceil(wait / 60)} min. / Too many tries.`, 429, { locked: wait });
  const b = await readJson(req);
  const user = await getRepo().getUser(String(b.username || ''));
  const allowed = user?.active && user.pinHash && (!user.locations?.length || user.locations.includes(device.locationCode));
  if (!allowed || !checkPin(String(b.pin || ''), user!.pinHash)) {
    noteFailure(who);
    await logActivity({ actor: String(b.username || '?'), source: 'dashboard', kind: 'login', action: 'pin_unlock', status: 'failed', locationCode: device.locationCode, summary: `Wrong PIN on tablet "${device.name}"` });
    return fail('NIP incorrect. / Wrong PIN.', 401);
  }
  noteSuccess(who);
  await logActivity({ actor: user!.name, source: 'dashboard', kind: 'login', action: 'pin_unlock', status: 'success', locationCode: device.locationCode, summary: `${user!.name} unlocked tablet "${device.name}"` });
  const res = NextResponse.json({ ok: true, user: { username: user!.username, name: user!.name, role: user!.role } });
  res.headers.append('Set-Cookie', await sessionCookieFor(user!, 'pin', device.id));
  return res;
}
