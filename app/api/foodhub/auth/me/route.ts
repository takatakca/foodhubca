import { getActor } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getDevice } from '@/lib/foodhub/identity/devices';
import { normalizeEmail, normalizePhone } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { ROLE_PERMISSIONS } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return fail('Please sign in.', 401);
  const user = actor.builtin ? null : await getRepo().getUser(actor.username);
  const device = actor.deviceId ? await getDevice(actor.deviceId) : null;
  return ok({
    user: {
      username: actor.username, name: actor.name, role: actor.role, locations: actor.locations, permissions: ROLE_PERMISSIONS[actor.role],
      builtin: Boolean(actor.builtin), email: user?.email ?? null, phone: user?.phone ?? null, hasPin: Boolean(user?.pinHash), prefs: user?.prefs ?? {},
      device: device ? { id: device.id, name: device.name, locationCode: device.locationCode } : null,
    },
  });
}

// Update your own profile: { name?, email?, phone?, prefs? }
export async function PATCH(req: Request) {
  const actor = await getActor(req);
  if (!actor) return fail('Please sign in.', 401);
  if (actor.builtin) return fail('The recovery login has no profile — create your own owner account.', 409);
  const user = await getRepo().getUser(actor.username);
  if (!user) return fail('User not found', 404);
  const b = await readJson(req);
  const email = b.email === undefined ? user.email : b.email ? normalizeEmail(b.email) : null;
  const phone = b.phone === undefined ? user.phone : b.phone ? normalizePhone(b.phone) : null;
  if (b.email && !email) return fail('Courriel invalide. / Invalid email.');
  if (b.phone && !phone) return fail('Numéro invalide. / Invalid phone number.');
  if (!email && !phone) return fail('Gardez au moins un courriel ou un cellulaire pour vous connecter. / Keep an email or a cell to sign in.');
  const others = (await getRepo().listUsers()).filter((u) => u.username !== user.username);
  if (email && others.some((u) => u.email?.toLowerCase() === email)) return fail('Ce courriel est déjà utilisé. / Email already used.');
  if (phone && others.some((u) => u.phone === phone)) return fail('Ce numéro est déjà utilisé. / Phone already used.');
  const prefs = b.prefs && typeof b.prefs === 'object' ? { ...(user.prefs ?? {}), ...b.prefs } : user.prefs;
  const saved = await getRepo().saveUser({ ...user, name: b.name ? String(b.name).trim().slice(0, 60) : user.name, email, phone, prefs });
  return ok({ user: { name: saved.name, email: saved.email, phone: saved.phone, prefs: saved.prefs } });
}
