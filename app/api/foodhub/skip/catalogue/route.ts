import { logActivity } from '@/lib/foodhub/activity';
import { withPerm } from '@/lib/foodhub/auth';
import { fail, ok, readJson } from '@/lib/foodhub/http';
import { publishSkipMenus, validateSkipMenusPayload, type SkipMenusPayload } from '@/lib/foodhub/menu/skip-catalogue';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// A catalogue already in JET Connect's shape (restaurant or grocery / retail: portions, nutrition, weights, deposits,
// GTIN, quantity restrictions…) checked against the published rules and sent to POST /menus.
//   POST { payload, dryRun? }   dryRun (or no key yet) → only the list of problems; nothing is sent
export const POST = withPerm('menu:edit', async (req, _ctx, actor) => {
  const b = await readJson(req);
  if (!b.payload) return fail('payload is required');
  const problems = validateSkipMenusPayload({ callback_url: undefined, ...b.payload });
  if (b.dryRun === true) return ok({ valid: problems.length === 0, problems });
  const res = await publishSkipMenus(b.payload as SkipMenusPayload);
  await logActivity({ actor: actor.name, source: actor.source, kind: 'menu_publish', action: 'skip_catalogue', status: res.ok ? 'queued' : 'failed', channel: 'skip', summary: `Skip catalogue (JET payload): ${res.message}` });
  return res.ok ? ok({ result: res }) : fail(res.message, res.status === 'blocked' ? 409 : 400, { result: res, problems });
});
