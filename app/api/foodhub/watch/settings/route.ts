import { approvalGate, withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { channelsStatus } from '@/lib/foodhub/notify';
import { KvUpdateConflict } from '@/lib/foodhub/repo';
import { can } from '@/lib/foodhub/session';
import { getWatchSettings, saveWatchSettings, WatchSettingsReadError } from '@/lib/foodhub/watch/engine';
import { INCIDENT_KINDS, KIND_LABEL, type WatchSettings } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';
const unavailable = () => fail('Impossible de charger les réglages d’alerte enregistrés. / Could not load the saved alert settings.', 503);

function canManageSharedPhone(actor: AuthUser): boolean {
  return can(actor.role, 'admin') && !actor.locations.length && !actor.deviceId;
}

function settingsResponse(settings: WatchSettings, actor: AuthUser, extra: Record<string, unknown> = {}) {
  const response = ok({
    ...extra,
    settings: { ...settings, screenAlertPhone: canManageSharedPhone(actor) ? settings.screenAlertPhone : null },
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

// Watchtower rules: what to watch, when to text / call / wake the owner, quiet hours, chat, AI.
export const GET = withPerm('view', async (_req, _ctx, actor) => {
  const settings = await getWatchSettings({ strict: true }).catch(() => null);
  if (!settings) return unavailable();
  return settingsResponse(settings, actor, {
    screenAlertPhoneConfigured: Boolean(settings.screenAlertPhone),
    kinds: INCIDENT_KINDS.map((k) => ({ kind: k, ...KIND_LABEL[k] })),
    channels: channelsStatus(),
  });
});

export const PUT = withPerm('admin', async (req, _ctx, actor) => {
  const b = await readJson(req);
  const patch = b.settings ?? {};
  if (Object.hasOwn(patch, 'screenAlertPhone') && !canManageSharedPhone(actor)) {
    return fail('Le numéro commun requiert un accès propriétaire à toutes les cuisines. / The shared phone requires account-wide owner access.', 403);
  }
  const gate = await approvalGate(req, actor, 'team.manage', null, 'alert rules');
  if (gate) return gate;
  try {
    return settingsResponse(await saveWatchSettings(patch, actor), actor);
  } catch (error) {
    if (error instanceof WatchSettingsReadError) return unavailable();
    if (error instanceof KvUpdateConflict) {
      return fail('Les réglages viennent de changer. Rechargez-les puis réessayez. / Alert settings changed. Reload them and try again.', 409);
    }
    throw error;
  }
});
