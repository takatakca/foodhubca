import { withPerm, type AuthUser } from '@/lib/foodhub/auth';
import { cancelRepublish, isNewAutomation, listAutomations, setSwitch, stopRetry } from '@/lib/foodhub/autopilot';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { can } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

/**
 * Who may change Autopilot: a manager or the owner (the "stores:map" permission of the Settings pages: Team, Platforms),
 * for every location — a switch acts on every kitchen, so a manager limited to some locations cannot flip it.
 */
function mayEdit(actor: AuthUser): boolean {
  return can(actor.role, 'stores:map') && (actor.role === 'owner' || actor.builtin === true || !actor.locations.length);
}

const REFUSED = { error: 'Only a manager of every location or the owner can change Autopilot.', errorFr: 'Seul un gérant de toutes les succursales ou le propriétaire peut changer le pilote automatique.' };

// Settings → Autopilot: every automation with its switch, its rule, the last run and what it did last.
export const GET = withPerm('view', async (_req, _ctx, actor) => ok({ automations: await listAutomations(), canEdit: mayEdit(actor) }));

// { id, on } — turns one of the new automations on or off (the others keep their own switch, where they already live).
export const PUT = withPerm('stores:map', async (req, _ctx, actor) => {
  if (!mayEdit(actor)) return fail(REFUSED.error, 403, { errorFr: REFUSED.errorFr });
  const b = await readJson(req);
  if (!isNewAutomation(b.id)) return fail('This automation is not switched from this page.', 400, { errorFr: 'Cette automatisation ne se règle pas sur cette page.' });
  if (typeof b.on !== 'boolean') return fail('on must be true or false', 400, { errorFr: 'Choisissez activé ou arrêté' });
  const state = await setSwitch(b.id, b.on, actor);
  return ok({ id: b.id, switch: state });
});

// Undo: { action: 'cancel_publish', id } (a re-publish not started yet) or { action: 'stop_retry', id } (a retry chain).
export const POST = withPerm('stores:map', async (req, _ctx, actor) => {
  if (!mayEdit(actor)) return fail(REFUSED.error, 403, { errorFr: REFUSED.errorFr });
  const b = await readJson(req);
  const id = String(b.id ?? '');
  if (!id) return fail('id is required', 400, { errorFr: 'Élément manquant' });
  if (b.action === 'cancel_publish') {
    return (await cancelRepublish(id, actor)) ? ok({ cancelled: id })
      : fail('That publish already started or is not Autopilot’s.', 409, { errorFr: 'Cette publication a déjà commencé ou ne vient pas du pilote automatique.' });
  }
  if (b.action === 'stop_retry') {
    const c = await stopRetry(id, actor);
    return c ? ok({ stopped: id }) : fail('Nothing to stop: that retry already ended.', 409, { errorFr: 'Rien à arrêter : ce nouvel essai est déjà terminé.' });
  }
  return fail('Unknown action', 400, { errorFr: 'Action inconnue' });
});
