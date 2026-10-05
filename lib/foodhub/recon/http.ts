import { errorResponse, withPerm, type AuthUser } from '../auth';
import { fail } from '../http';
import type { Permission } from '../session';

/** Finance covers every location's money, so it is limited to users who see all locations. */
export function withFinance<C = unknown>(perm: Permission, handler: (req: Request, ctx: C, actor: AuthUser) => Promise<Response>) {
  return withPerm<C>(perm, async (req, ctx, actor) => {
    if (actor.locations.length) return fail('Payouts and reconciliation are available to users with access to all locations.', 403);
    try {
      return await handler(req, ctx, actor);
    } catch (e) {
      // Validation messages keep their text (400); Supabase/Postgres/network errors never reach the browser (generic 500 + log).
      return errorResponse(e, `${req.method} ${new URL(req.url).pathname}`);
    }
  });
}
