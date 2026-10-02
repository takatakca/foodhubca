import { NextResponse } from 'next/server';
import { signOutCookie } from '@/lib/foodhub/auth';

export const dynamic = 'force-dynamic';

export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.headers.append('Set-Cookie', signOutCookie());
  return res;
}
