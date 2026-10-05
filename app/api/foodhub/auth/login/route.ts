import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { signIn } from '@/lib/foodhub/auth';
import { fail, readJson } from '@/lib/foodhub/http';
import { clientIp } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Owner recovery sign-in ("owner" + DASHBOARD_PASSWORD) and older password accounts.
// Everyone else signs in with a code or link (auth/start → auth/verify).
export async function POST(req: Request) {
  const b = await readJson(req);
  const who = String(b.username || 'owner').slice(0, 40);
  const r = await signIn(who, String(b.password || ''), clientIp(req.headers));
  if ('error' in r) {
    if (r.status !== 429) await logActivity({ actor: who, source: 'dashboard', kind: 'login', action: 'sign_in', status: 'failed', summary: `Failed recovery sign-in for ${who}` });
    return fail(r.error, r.status);
  }
  await logActivity({ actor: r.user.name, source: 'dashboard', kind: 'login', action: 'sign_in', status: 'success', summary: `${r.user.name} signed in with the recovery password (${r.user.role})` });
  const res = NextResponse.json({ ok: true, user: { username: r.user.username, name: r.user.name, role: r.user.role, locations: r.user.locations } });
  res.headers.append('Set-Cookie', r.cookie);
  return res;
}
