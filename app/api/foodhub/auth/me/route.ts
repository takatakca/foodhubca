import { getActor } from '@/lib/foodhub/auth';
import { fail, ok } from '@/lib/foodhub/http';
import { ROLE_PERMISSIONS } from '@/lib/foodhub/session';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const actor = await getActor(req);
  if (!actor) return fail('Please sign in.', 401);
  return ok({ user: { username: actor.username, name: actor.name, role: actor.role, locations: actor.locations, permissions: ROLE_PERMISSIONS[actor.role] } });
}
