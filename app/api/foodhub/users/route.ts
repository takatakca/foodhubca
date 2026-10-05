import { logActivity } from '@/lib/foodhub/activity';
import { approvalGate, hashPassword, passwordProblem, withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { publicBaseUrl } from '@/lib/foodhub/config';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { hashPin, pinProblem, pinTakenByOther } from '@/lib/foodhub/identity/pin';
import { normalizeEmail, normalizePhone, sendEmail, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { ROLE_LABELS, ROLE_LABELS_FR } from '@/lib/foodhub/session';
import type { FoodHubUser, Role } from '@/lib/foodhub/types';

export const dynamic = 'force-dynamic';

const ROLES = Object.keys(ROLE_LABELS) as Role[];
const SENIOR: Role[] = ['owner', 'manager'];

function safe(u: FoodHubUser) {
  const { passwordHash: _p, pinHash: _n, ...rest } = u;
  return { ...rest, hasPin: Boolean(u.pinHash), hasPassword: Boolean(u.passwordHash) };
}

// The team. The owner manages everyone; a manager manages staff, menu editors and analysts at their locations.
export const GET = withPerm('stores:map', async (_req, _ctx, actor) => {
  const users = (await getRepo().listUsers()).filter((u) => actor.role === 'owner' || actor.builtin || !u.locations.length || u.locations.some((l) => !actor.locations.length || actor.locations.includes(l)));
  return ok({
    roles: ROLES.map((r) => ({ role: r, label: ROLE_LABELS[r], labelFr: ROLE_LABELS_FR[r] })),
    users: users.map(safe),
  });
});

// Create or update a person: { username?, name, role, locations, email?, phone?, active?, pin?, invite? }
// Sign-in uses the email / cell (one-time code); the PIN unlocks kitchen tablets and approves actions.
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const repo = getRepo();
  const all = await repo.listUsers();
  const isOwner = actor.role === 'owner';
  let username = String(b.username || '').toLowerCase().trim();
  const existing = username ? all.find((u) => u.username === username) ?? null : null;
  const name = String(b.name ?? existing?.name ?? '').trim().slice(0, 60);
  if (!name) return fail('Nom requis. / Name is required.');
  if (!username) {
    const base = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '.').replace(/(^\.|\.$)/g, '').slice(0, 28) || 'user';
    username = base;
    for (let i = 2; all.some((u) => u.username === username) || username === 'owner'; i++) username = `${base}${i}`;
  }
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return fail('Username: 3–40 letters, digits, dot, dash or underscore.');
  if (username === 'owner') return fail('"owner" is the built-in recovery login.');
  const role = String(b.role || existing?.role || '') as Role;
  if (!ROLES.includes(role)) return fail(`role must be one of ${ROLES.join(', ')}`);
  if (!isOwner && (SENIOR.includes(role) || (existing && SENIOR.includes(existing.role)))) return fail('Seul le propriétaire gère les gérants. / Only the owner manages managers.', 403);

  const catalog = await getCatalog();
  let locations: string[] = Array.isArray(b.locations) ? b.locations.map(String).filter((c: string) => catalog.locations.some((l) => l.code === c)) : existing?.locations ?? [];
  if (!isOwner && actor.locations.length) {
    if (!locations.length) locations = [...actor.locations];
    if (locations.some((l) => !actor.locations.includes(l))) return fail('Only your own locations.', 403);
  }

  const email = b.email === undefined ? existing?.email ?? null : b.email ? normalizeEmail(b.email) : null;
  const phone = b.phone === undefined ? existing?.phone ?? null : b.phone ? normalizePhone(b.phone) : null;
  if (b.email && !email) return fail('Courriel invalide. / Invalid email.');
  if (b.phone && !phone) return fail('Numéro de cellulaire invalide. / Invalid cell number.');
  const others = all.filter((u) => u.username !== username);
  if (email && others.some((u) => u.email?.toLowerCase() === email)) return fail('Ce courriel est déjà utilisé. / Email already used.');
  if (phone && others.some((u) => u.phone === phone)) return fail('Ce numéro est déjà utilisé. / Phone already used.');

  let pinHash = existing?.pinHash ?? null;
  if (b.pin) {
    const p = String(b.pin).trim();
    const problem = pinProblem(p);
    if (problem) return fail(problem);
    if (await pinTakenByOther(p, username)) return fail('Ce NIP est déjà utilisé. / That PIN is taken.');
    pinHash = hashPin(p);
  }
  if (b.clearPin) pinHash = null;
  let passwordHash = existing?.passwordHash ?? null;
  if (b.password) {
    const problem = passwordProblem(String(b.password));
    if (problem) return fail(problem);
    passwordHash = hashPassword(String(b.password));
  }
  if (!email && !phone && !pinHash && !passwordHash) return fail('Ajoutez un courriel, un cellulaire ou un NIP. / Add an email, a cell number or a PIN.');

  const gate = await approvalGate(req, actor, 'team.manage', locations[0] ?? null, `${existing ? 'update' : 'add'} ${name}`);
  if (gate) return gate;

  const user = await repo.saveUser({
    username, name, role, locations, email, phone, pinHash, passwordHash,
    prefs: { ...(existing?.prefs ?? { lang: 'fr', alertSms: SENIOR.includes(role), alertCall: SENIOR.includes(role), onDuty: SENIOR.includes(role) }), ...(b.prefs && typeof b.prefs === 'object' ? b.prefs : {}) },
    active: b.active === undefined ? existing?.active ?? true : Boolean(b.active), lastLoginAt: existing?.lastLoginAt ?? null,
  });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'users', action: existing ? 'update_user' : 'create_user', status: 'success',
    summary: `${existing ? 'Updated' : 'Added'} ${name} (${role}${locations.length ? `, ${locations.join('/')}` : ', all locations'})${b.pin ? ', PIN set' : ''}${user.active ? '' : ', deactivated'}` });

  let invite: { ok: boolean; message: string } | null = null;
  if (b.invite && (email || phone) && user.active) {
    const url = `${publicBaseUrl()}/login`;
    const first = name.split(' ')[0];
    const r = email
      ? await sendEmail({ to: email, subject: 'Bienvenue sur TAKATAK / Welcome to TAKATAK', text: `Bonjour ${first},\n\n${actor.name} vous a ajouté(e) à TAKATAK Food Hub.\nConnectez-vous ici avec ce courriel — un code vous sera envoyé : ${url}\n\n— ${actor.name} added you to TAKATAK Food Hub. Sign in with this email at ${url} (a code is sent, no password).` }, { purpose: 'invite', by: actor.name })
      : await sendSms({ to: phone!, body: `TAKATAK : ${actor.name} vous a ajouté(e). Connectez-vous avec ce numéro : ${url}` }, { purpose: 'invite', by: actor.name });
    invite = { ok: r.ok, message: r.message };
  }
  return ok({ user: safe(user), invite });
});
