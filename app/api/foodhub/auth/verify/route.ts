import { NextResponse } from 'next/server';
import { errorResponse, sessionCookieFor } from '@/lib/foodhub/auth';
import { fail, readJson } from '@/lib/foodhub/http';
import { verifyCode } from '@/lib/foodhub/identity/otp';

export const dynamic = 'force-dynamic';

// Step 2 of sign-in: { challengeId, code } → signed session cookie.
export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const r = await verifyCode(String(b.challengeId || ''), String(b.code || ''));
    if (!r.ok) return fail(r.error, r.status);
    const res = NextResponse.json({ ok: true, next: r.next, user: { username: r.user.username, name: r.user.name, role: r.user.role, hasPin: Boolean(r.user.pinHash) } });
    res.headers.append('Set-Cookie', await sessionCookieFor(r.user, 'otp'));
    return res;
  } catch (e) {
    return errorResponse(e, 'auth'); // never echo database errors to someone who is not signed in
  }
}
