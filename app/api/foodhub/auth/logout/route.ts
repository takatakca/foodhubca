import { NextResponse } from 'next/server';
import { signOutCookie } from '@/lib/foodhub/auth';
import { DEVICE_COOKIE, readCookie, verifyDevice } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

// Sign out (or "Lock" on a kitchen tablet): the session ends, the tablet enrolment stays.
export async function POST(req: Request) {
  const device = await verifyDevice(readCookie(req.headers.get('cookie'), DEVICE_COOKIE));
  const res = NextResponse.json({ ok: true, next: device ? '/kitchen/lock' : '/login' });
  res.headers.append('Set-Cookie', signOutCookie());
  return res;
}
