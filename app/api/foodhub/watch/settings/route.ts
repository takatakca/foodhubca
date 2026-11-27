import { approvalGate, withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { channelsStatus } from '@/lib/foodhub/notify';
import { can } from '@/lib/foodhub/session';
import { getWatchSettings, saveWatchSettings } from '@/lib/foodhub/watch/engine';
import { INCIDENT_KINDS, KIND_LABEL, type WatchSettings } from '@/lib/foodhub/watch/types';

export const dynamic = 'force-dynamic';

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
  const settings = await getWatchSettings();
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
  return settingsResponse(await saveWatchSettings(patch, actor), actor);
});
