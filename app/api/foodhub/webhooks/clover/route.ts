import { NextResponse, type NextRequest } from 'next/server';
import { logActivity } from '@/lib/foodhub/activity';
import { handleCloverWebhook, VERIFY_KEY } from '@/lib/foodhub/clover-sync';
import { nowIso, safeEqual } from '@/lib/foodhub/config';
import { getRepo } from '@/lib/foodhub/repo';
import { background, parseJson } from '@/lib/foodhub/webhook-utils';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** The handshake is public: store/log a code at most this often, and only when it changed. */
const VERIFY_MIN_INTERVAL_MS = 60_000;

// Clover app webhooks (Clover developer dashboard → your app → Webhooks):
//  1. Clover first POSTs { verificationCode } — Food Hub shows it on Channels; paste it back in Clover.
//     Public by design (Clover re-verifies when the URL changes): stored/logged only when the code changed, at most once a minute.
//  2. Every event carries the header X-Clover-Auth = the auth code Clover shows → CLOVER_WEBHOOK_AUTH.
//  3. Subscribe to "Inventory" events: an item changed in Clover → availability/price sync to every platform.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const body = parseJson(raw);
  if (body === undefined) return NextResponse.json({ ok: false }, { status: 400 });
  const expected = process.env.CLOVER_WEBHOOK_AUTH;

  if (body.verificationCode) {
    const repo = getRepo();
    const code = String(body.verificationCode).slice(0, 200);
    const current = await repo.getKv<{ code: string; at: string }>(VERIFY_KEY).catch(() => null);
    const recent = Boolean(current?.at) && Date.now() - new Date(String(current?.at)).getTime() < VERIFY_MIN_INTERVAL_MS;
    if (current?.code !== code) {
      await repo.setKv(VERIFY_KEY, { code, at: nowIso() });
      if (!recent) await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_webhook_verification', status: 'info', summary: 'Clover sent a webhook verification code — copy it from Channels & Setup into the Clover developer dashboard.' });
    }
    return NextResponse.json({ ok: true });
  }

  if (!expected || !safeEqual(String(req.headers.get('x-clover-auth') || ''), expected)) {
    return NextResponse.json({ ok: false, error: 'X-Clover-Auth check failed (set CLOVER_WEBHOOK_AUTH).' }, { status: 401 });
  }
  background('clover inventory webhook', () => handleCloverWebhook(body));
  return NextResponse.json({ ok: true });
}
