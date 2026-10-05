import { fail, ok, readJson } from '@/lib/foodhub/http';
import { createFirstOwner, firstRunNeeded, startChallenge } from '@/lib/foodhub/identity/otp';

export const dynamic = 'force-dynamic';

// First run: is there an owner yet? Creating it needs dev mode, FOODHUB_OWNER_EMAIL/PHONE, or the setup key.
export async function GET() {
  const needed = await firstRunNeeded().catch(() => false);
  return ok({
    needed,
    needsKey: needed && process.env.NODE_ENV === 'production' && !process.env.FOODHUB_OWNER_EMAIL && !process.env.FOODHUB_OWNER_PHONE,
    recovery: Boolean(process.env.DASHBOARD_PASSWORD),
  });
}

export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const r = await createFirstOwner({ name: b.name, email: b.email, phone: b.phone, setupKey: b.setupKey });
    if (!r.ok) return fail(r.error, r.status);
    const s = await startChallenge(String(r.user.email || r.user.phone), { next: '/', origin: new URL(req.url).origin, lang: b.lang === 'en' ? 'en' : 'fr' });
    if (!s.ok) return fail(s.error, s.status);
    return ok({ challengeId: s.challengeId, channel: s.channel, sentTo: s.sentTo, ...(s.devCode ? { devCode: s.devCode, devLink: s.devLink } : {}) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
