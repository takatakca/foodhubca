// Shared first step of every Clover app webhook (one route per app, see clover-apps.ts):
//  1. Clover's handshake { verificationCode } — stored under that app's own key (the owner pastes it back in that
//     app's page of the Clover developer dashboard). Public by design; stored/logged only when the code changed, and
//     logged at most once a minute.
//  2. Every other POST must carry X-Clover-Auth = that app's own auth code (CLOVER_WEBHOOK_AUTH for Food Hub,
//     CLOVER_PHONE_WEBHOOK_AUTH for the phone app). One app's code never opens the other app's webhook.
// The route then dispatches the events to that app's handlers only.
import { logActivity } from '../activity';
import { nowIso, safeEqual } from '../config';
import { getRepo } from '../repo';
import { cloverApp, type CloverAppKey } from './clover-apps';

/** The handshake is public: store/log a code at most this often, and only when it changed. */
const VERIFY_MIN_INTERVAL_MS = 60_000;

export type CloverWebhookGate = { done: true; status: number; json: Record<string, unknown> } | { done: false };

export async function cloverWebhookGate(app: CloverAppKey, body: any, authHeader: string | null): Promise<CloverWebhookGate> {
  const def = cloverApp(app);
  if (body?.verificationCode) {
    const repo = getRepo();
    const code = String(body.verificationCode).slice(0, 200);
    const current = await repo.getKv<{ code: string; at: string }>(def.verifyKey).catch(() => null);
    const recent = Boolean(current?.at) && Date.now() - new Date(String(current?.at)).getTime() < VERIFY_MIN_INTERVAL_MS;
    if (current?.code !== code) {
      await repo.setKv(def.verifyKey, { code, at: nowIso() });
      if (!recent) {
        await logActivity({ actor: 'Clover', source: 'platform', kind: 'settings', action: 'clover_webhook_verification', status: 'info',
          summary: app === 'foodhub'
            ? 'Clover sent a webhook verification code — copy it from Channels & Setup into the Clover developer dashboard.'
            : `Clover sent a webhook verification code for ${def.name} — copy it from Settings → Clover app into that app's page of the Clover developer dashboard.` });
      }
    }
    return { done: true, status: 200, json: { ok: true } };
  }
  // The app's own code from its definition: raw for Food Hub, exactly as before (no trimming); trimmed for a new app.
  const expected = def.webhookAuth;
  if (!expected || !safeEqual(String(authHeader || ''), expected)) {
    return { done: true, status: 401, json: { ok: false, error: `X-Clover-Auth check failed (set ${def.env.webhookAuth}).` } };
  }
  return { done: false };
}

/** The last verification code Clover sent to one app's webhook (not a secret: Clover shows it to the owner too). */
export async function cloverWebhookVerification(app: CloverAppKey): Promise<{ code: string; at: string } | null> {
  return getRepo().getKv<{ code: string; at: string }>(cloverApp(app).verifyKey).catch(() => null);
}
