import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { hashPin, pinProblem, pinTakenByOther } from '@/lib/foodhub/identity/pin';
import { getRepo } from '@/lib/foodhub/repo';

export const dynamic = 'force-dynamic';

// Set or change your own PIN: { pin }.
export const POST = withPerm('view', async (req, _ctx, actor) => {
  if (actor.builtin) return fail('Le compte de secours n’a pas de NIP — connectez-vous avec votre propre compte. / The recovery login has no PIN.', 409);
  const b = await readJson(req);
  const pin = String(b.pin || '').trim();
  const problem = pinProblem(pin);
  if (problem) return fail(problem);
  if (await pinTakenByOther(pin, actor.username)) return fail('Ce NIP est déjà utilisé — choisissez-en un autre. / That PIN is taken — pick another.');
  const user = await getRepo().getUser(actor.username);
  if (!user) return fail('User not found', 404);
  await getRepo().saveUser({ ...user, pinHash: hashPin(pin) });
  await logActivity({ actor: actor.name, source: actor.source, kind: 'security', action: 'pin_set', status: 'success', summary: `${actor.name} ${user.pinHash ? 'changed' : 'set'} their PIN` });
  return ok({ hasPin: true });
});
