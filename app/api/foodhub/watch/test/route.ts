import { withPerm } from '@/lib/foodhub/auth';
import { runDry, type DryRun } from '@/lib/foodhub/dry-run';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { callConfigured, channelsStatus, placeCall, postToChat, sendEmail, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { firstAlertCallTarget, getWatchSettings } from '@/lib/foodhub/watch/engine';
import type { SharedScreenCallPreview, SharedScreenCallPreviewCheck, WatchSettings } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

const screenAlertKinds = ['screen_down', 'screen_waiting'] as const;

async function simulateSharedCall(kind: SharedScreenCallPreviewCheck['kind'], settings: WatchSettings): Promise<SharedScreenCallPreviewCheck> {
  if (!settings.enabled) return { kind, state: 'watch-off', destination: null };
  const rule = settings.rules[kind];
  if (rule.enabled === false || !rule.escalate) return { kind, state: 'rule-off', destination: null };
  const target = firstAlertCallTarget(kind, settings.screenAlertPhone);
  if (!target) return { kind, state: 'missing-number', destination: null };

  // The run covers only the call; full Watchtower runs also create and update incidents.
  const dry: DryRun = { sent: [] };
  await runDry(dry, () => placeCall({ to: target.to, say: 'Test de destination des alertes d’écran.' }, { purpose: target.purpose }));
  const destination = dry.sent[0]?.to;
  return destination ? { kind, state: 'simulated', destination } : { kind, state: 'missing-number', destination: null };
}

const preview = withPerm('admin', async (_req, _ctx, actor) => {
  if (actor.locations.length || actor.deviceId) return fail('This check requires account-wide access.', 403);
  const settings = await getWatchSettings();
  const result: SharedScreenCallPreview = {
    callConfigured: callConfigured(),
    checks: await Promise.all(screenAlertKinds.map((kind) => simulateSharedCall(kind, settings))),
  };
  return ok({ ...result });
});

export async function GET(req: Request, ctx: unknown) {
  const response = await preview(req, ctx);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// "Test" buttons: { channel: 'sms' | 'call' | 'email' | 'chat' } → sent to the signed-in person.
export const POST = withPerm('view', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const user = actor.builtin ? null : await getRepo().getUser(actor.username);
  const lang = user?.prefs?.lang ?? 'fr';
  const meta = { purpose: 'test', by: actor.name };
  const channel = String(b.channel || '');
  if (channel === 'chat') return ok({ result: await postToChat({ title: lang === 'fr' ? `Test d’alerte TAKATAK par ${actor.name}` : `TAKATAK alert test by ${actor.name}`, severity: 'info' }, meta), channels: channelsStatus() });
  if (channel === 'sms') {
    if (!user?.phone) return fail('Ajoutez votre cellulaire dans votre profil. / Add your cell number to your profile.');
    return ok({ result: await sendSms({ to: user.phone, body: lang === 'fr' ? 'TAKATAK : test d’alerte réussi. Vous recevrez les alertes ici.' : 'TAKATAK: alert test OK. Alerts will come here.' }, meta) });
  }
  if (channel === 'call') {
    if (!user?.phone) return fail('Ajoutez votre cellulaire dans votre profil. / Add your cell number to your profile.');
    return ok({ result: await placeCall({ to: user.phone, say: lang === 'fr' ? 'Ceci est un test des alertes TAKATAK. Tout fonctionne.' : 'This is a TAKATAK alert test. Everything works.', lang }, meta) });
  }
  if (channel === 'email') {
    if (!user?.email) return fail('Ajoutez votre courriel dans votre profil. / Add your email to your profile.');
    return ok({ result: await sendEmail({ to: user.email, subject: 'TAKATAK — test', text: lang === 'fr' ? 'Test d’alerte réussi.' : 'Alert test OK.' }, meta) });
  }
  return fail('channel must be sms, call, email or chat');
});
