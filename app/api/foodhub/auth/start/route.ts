import { fail, ok, readJson } from '@/lib/foodhub/http';
import { startChallenge } from '@/lib/foodhub/identity/otp';

export const dynamic = 'force-dynamic';

// Step 1 of sign-in: { contact: "email or cell", next?: "/orders", lang?: "fr" } → a code + link is sent.
export async function POST(req: Request) {
  try {
    const b = await readJson(req);
    const r = await startChallenge(String(b.contact || ''), { next: b.next, origin: new URL(req.url).origin, lang: b.lang === 'en' ? 'en' : 'fr' });
    if (!r.ok) return fail(r.error, r.status);
    return ok({ challengeId: r.challengeId, channel: r.channel, sentTo: r.sentTo, ...(r.devCode ? { devCode: r.devCode, devLink: r.devLink } : {}) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e), 500);
  }
}
