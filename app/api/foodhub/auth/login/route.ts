import { logActivity } from '@/lib/foodhub/activity';
import { signIn } from '@/lib/foodhub/auth';
import { fail, readJson } from '@/lib/foodhub/http';
import { clientIp } from '@/lib/foodhub/session';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const b = await readJson(req);
  const r = await signIn(String(b.username || 'owner'), String(b.password || ''), clientIp(req.headers));
  if ('error' in r) {
    const who = String(b.username || 'owner').slice(0, 40);
    if (r.status !== 429) await logActivity({ actor: who, source: 'dashboard', kind: 'login', action: 'sign_in', status: 'failed', summary: `Failed sign-in for ${who}` });
    return fail(r.error, r.status);
  }
  await logActivity({ actor: r.user.name, source: 'dashboard', kind: 'login', action: 'sign_in', status: 'success', summary: `${r.user.name} signed in (${r.user.role})` });
  const res = NextResponse.json({ ok: true, user: { username: r.user.username, name: r.user.name, role: r.user.role, locations: r.user.locations } });
  res.headers.append('Set-Cookie', r.cookie);
  return res;
}
