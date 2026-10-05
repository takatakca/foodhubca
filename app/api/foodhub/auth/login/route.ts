import { NextResponse } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { signIn } from '@/lib/foodhub/auth';
import { fail, readJson } from '@/lib/foodhub/http';

export const dynamic = 'force-dynamic';

// Owner recovery sign-in ("owner" + DASHBOARD_PASSWORD) and older password accounts.
// Everyone else signs in with a code or link (auth/start → auth/verify).
export async function POST(req: Request) {
  const b = await readJson(req);
  const r = await signIn(String(b.username || 'owner'), String(b.password || ''));
  if ('error' in r) {
    await logActivity({ actor: String(b.username || 'owner'), source: 'dashboard', kind: 'login', action: 'sign_in', status: 'failed', summary: `Failed recovery sign-in for ${String(b.username || 'owner')}` });
    return fail(r.error, r.status);
  }
  await logActivity({ actor: r.user.name, source: 'dashboard', kind: 'login', action: 'sign_in', status: 'success', summary: `${r.user.name} signed in with the recovery password (${r.user.role})` });
  const res = NextResponse.json({ ok: true, user: { username: r.user.username, name: r.user.name, role: r.user.role, locations: r.user.locations } });
  res.headers.append('Set-Cookie', r.cookie);
  return res;
}
