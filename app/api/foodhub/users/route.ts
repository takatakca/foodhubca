import { logActivity } from '@/lib/foodhub/activity';
import { hashPassword, passwordProblem, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { getRepo } from '@/lib/foodhub/repo';
import { ROLE_LABELS } from '@/lib/foodhub/session';
import type { Role } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

const ROLES = Object.keys(ROLE_LABELS) as Role[];

export const GET = withPerm('admin', async () => {
  const users = await getRepo().listUsers();
  return ok({
    roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r] })),
    users: users.map(({ passwordHash: _p, ...u }) => u),
  });
});

// Create or update a team member. Password only when creating or resetting.
export const POST = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const username = String(b.username || '').toLowerCase().trim();
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fail('Username: 3–40 letters, digits, dot, dash or underscore.');
  if (username === 'owner') return fail('"owner" is the built-in owner login (DASHBOARD_PASSWORD).');
  const role = String(b.role || '') as Role;
  if (!ROLES.includes(role)) return fail(`role must be one of ${ROLES.join(', ')}`);
  const catalog = await getCatalog();
  const locations: string[] = Array.isArray(b.locations) ? b.locations.map(String).filter((c: string) => catalog.locations.some((l) => l.code === c)) : [];
  const repo = getRepo();
  const existing = await repo.getUser(username);
  let passwordHash = existing?.passwordHash;
  if (b.password) {
    const problem = passwordProblem(String(b.password));
    if (problem) return fail(problem);
    passwordHash = hashPassword(String(b.password));
  }
  if (!passwordHash) return fail('A password is required for a new user.');
  const user = await repo.saveUser({
    username, name: String(b.name || existing?.name || username).trim(), role, locations,
    passwordHash, active: b.active === undefined ? existing?.active ?? true : Boolean(b.active), lastLoginAt: existing?.lastLoginAt ?? null,
  });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'users', action: existing ? 'update_user' : 'create_user', status: 'success',
    summary: `${existing ? 'Updated' : 'Created'} user ${username} (${role}${locations.length ? `, ${locations.join('/')}` : ', all locations'})${b.password && existing ? ', password reset' : ''}${user.active ? '' : ', deactivated'}` });
  const { passwordHash: _p, ...safe } = user;
  return ok({ user: safe });
});
