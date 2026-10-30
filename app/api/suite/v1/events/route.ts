import { z } from 'zod';
import { fail, ok } from '@/lib/foodhub/http';
import { authenticateApp } from '@/lib/foodhub/suite/auth';
import { receiveAppEvent } from '@/lib/foodhub/suite/bus';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 64 * 1024;
const schema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/),
  type: z.string().regex(/^[a-z0-9]+\.[a-z0-9_.]{1,80}$/),
  data: z.unknown().optional(),
});

// POST /api/suite/v1/events — a suite app tells the others something ("loy4lty.points_awarded", "rew4rd.redeemed"…).
// The type must start with the app's own key. Food Hub logs it and passes it on as `app.event` (each event id once).
export async function POST(req: Request) {
  const body = await req.text();
  if (body.length > MAX_BYTES) return fail('Event too large (64 KB max)', 413);
  const a = authenticateApp(req, body);
  if ('error' in a) return fail(a.error, a.status);
  let json: unknown;
  try { json = JSON.parse(body); } catch { return fail('Invalid JSON'); }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return fail('Invalid event: { id, type: "<app>.<name>", data }');
  if (!parsed.data.type.startsWith(`${a.app.key}.`)) return fail(`Event type must start with "${a.app.key}."`, 403);
  return ok(await receiveAppEvent(a.app.key, parsed.data));
}
