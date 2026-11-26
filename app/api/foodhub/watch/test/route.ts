import { withPerm } from '@/lib/foodhub/auth';
import { getCatalog } from '@/lib/foodhub/catalog';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { callConfigured, channelsStatus, maskPhone, normalizePhone, placeCall, postToChat, sendEmail, sendSms } from '@/lib/foodhub/notify';
import { getRepo } from '@/lib/foodhub/repo';
import { firstAlertCallTarget, getWatchSettings } from '@/lib/foodhub/watch/engine';
import type { KitchenCallPreview, KitchenCallPreviewCheck, SharedScreenCallPreview, WatchSettings } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

const screenAlertKinds = ['screen_down', 'screen_waiting'] as const;
const kitchenAlertKinds = ['device_offline', ...screenAlertKinds] as const;

function simulateCall(kind: KitchenCallPreviewCheck['kind'], settings: WatchSettings, kitchenPhone?: string): KitchenCallPreviewCheck {
  const unavailable = { kind, destination: null, source: null };
  if (!settings.enabled) return { ...unavailable, state: 'watch-off' };
  const rule = settings.rules[kind];
  if (rule.enabled === false || !rule.escalate) return { ...unavailable, state: 'rule-off' };
  const target = firstAlertCallTarget(kind, settings.screenAlertPhone, kitchenPhone);
  const destination = normalizePhone(target?.to);
  if (!target || !destination) return { ...unavailable, state: 'missing-number' };
  return { kind, state: 'simulated', destination: maskPhone(destination), source: target.purpose === 'alert_shared_screen' ? 'shared' : 'kitchen' };
}

const preview = withPerm('admin', async (req, _ctx, actor) => {
  if (actor.locations.length || actor.deviceId) return fail('This check requires account-wide access.', 403);
  const settings = await getWatchSettings();
  const locationCode = new URL(req.url).searchParams.get('locationCode');
  if (locationCode !== null) {
    const catalog = await getCatalog({ strict: true }).catch(() => null);
    if (!catalog) return fail('Could not load the saved kitchens.', 503);
    const kitchen = catalog.locations.find((location) => location.code === locationCode && location.active);
    if (!kitchen) return fail('Active kitchen not found.', 404);
    const result: KitchenCallPreview = {
      callConfigured: callConfigured(), locationCode,
      checks: kitchenAlertKinds.map((kind) => simulateCall(kind, settings, kitchen.phone ?? undefined)),
    };
    return ok({ ...result });
  }
  const result: SharedScreenCallPreview = {
    callConfigured: callConfigured(),
    checks: screenAlertKinds.map((kind) => {
      const { state, destination } = simulateCall(kind, settings);
      return { kind, state, destination };
    }),
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
